/**
 * What a tag refresh reads: the files with a tag, and the signals that point at files without it.
 * Each query names its scope with the CTEs of `refresh-scope.ts`.
 */
import type { FileRow, Tag } from '../../types.ts';
import type { Sql } from './connection.ts';
import { FILE_COLUMNS, type RawFileRow, toFileRow } from './file-query.ts';
import { fileName } from './paths.ts';
import {
  type RefreshScope,
  ruledOutFilesCte,
  tagOrChildCondition,
  taggedFilesCte,
} from './refresh-scope.ts';

/** How many files the index holds. */
const countIndexedFiles = (sql: Sql): number =>
  sql.get<{ n: number }>('SELECT count(*) AS n FROM file')!.n;

/** Files with the tag, the most recently modified first, and how many there are in all. */
export function refreshSeeds(sql: Sql, tag: Tag, limit: number): { ids: number[]; total: number } {
  const tagged = taggedFilesCte(tag);
  const newestFirst = sql.all<{ id: number }>(
    `WITH ${tagged.sql} SELECT f.id FROM file f JOIN tagged ON tagged.file_id = f.id
     ORDER BY CAST(f.mtime_ns AS INTEGER) DESC, f.id DESC LIMIT ?`,
    ...tagged.params,
    limit,
  );
  const { total } = sql.get<{ total: number }>(
    `WITH ${tagged.sql} SELECT count(*) AS total FROM tagged`,
    ...tagged.params,
  )!;
  return { ids: newestFirst.map((row) => row.id), total };
}

/** A tag seen on files that have the refreshed tag. */
export interface CoTagCount {
  tag: Tag;
  /** The tag's facet weight in similarity. */
  weight: number;
  /** Document frequency: files with this tag, counted now rather than read from `tag.df`. */
  df: number;
  /** Co-occurrence: files with both tags. */
  co: number;
}

/**
 * Every other tag on files with the tag, and the counts lift and IDF need: `files` is how many
 * files the index holds, and each row counts one co-occurring tag.
 */
export function coTagCounts(sql: Sql, tag: Tag): { files: number; rows: CoTagCount[] } {
  const tagged = taggedFilesCte(tag);
  const tagOrChild = tagOrChildCondition(tag);
  const rows = sql.all<CoTagCount>(
    `WITH ${tagged.sql}
     SELECT t.name AS tag, t.weight, count(*) AS co,
       (SELECT count(*) FROM file_tag every_use WHERE every_use.tag_id = t.id) AS df
     FROM tagged JOIN file_tag ft ON ft.file_id = tagged.file_id JOIN tag t ON t.id = ft.tag_id
     WHERE NOT ${tagOrChild.sql} AND t.weight > 0
     GROUP BY t.id ORDER BY t.name`,
    ...tagged.params,
    ...tagOrChild.params,
  );
  return { files: countIndexedFiles(sql), rows };
}

/** A term as an FTS5 string. Callers pass letters and digits only, so this is belt and braces. */
const ftsQuotedTerm = (term: string) => `"${term.replaceAll('"', '""')}"`;

/** How many searchable texts there are, and how many hold each term. */
export function contentFrequencies(
  sql: Sql,
  terms: string[],
): { docs: number; df: Map<string, number> } {
  const { docs } = sql.get<{ docs: number }>('SELECT count(*) AS docs FROM content')!;
  const countTextsHolding = (term: string) =>
    sql.get<{ n: number }>(
      'SELECT count(*) AS n FROM content WHERE content MATCH ?',
      ftsQuotedTerm(term),
    )!.n;
  const df = new Map(terms.map((term) => [term, countTextsHolding(term)] as const));
  return { docs, df };
}

/** Files outside the scope whose text holds any of the terms, by BM25 rank, best first. */
export function contentCandidates(
  sql: Sql,
  scope: RefreshScope,
  terms: string[],
  limit: number,
): { id: number; rank: number }[] {
  if (terms.length === 0) return [];
  const ruledOut = ruledOutFilesCte(scope);
  const anyTermQuery = terms.map(ftsQuotedTerm).join(' OR ');
  return sql.all(
    `WITH ${ruledOut.sql}
     SELECT rowid AS id, rank FROM content WHERE content MATCH ?
       AND rowid NOT IN (SELECT file_id FROM ruled_out)
     ORDER BY rank, rowid LIMIT ?`,
    ...ruledOut.params,
    anyTermQuery,
    limit,
  );
}

/** Files outside the scope with any of the weighted tags, by their summed weight, best first. */
export function coTagCandidates(
  sql: Sql,
  scope: RefreshScope,
  weights: [Tag, number][],
  limit: number,
): { id: number; score: number; tags: Tag[] }[] {
  if (weights.length === 0) return [];
  const ruledOut = ruledOutFilesCte(scope);
  const rows = sql.all<{ id: number; score: number; tags: string }>(
    `WITH ${ruledOut.sql},
       weighted AS (SELECT json_extract(value, '$[0]') AS name, json_extract(value, '$[1]') AS weight
                    FROM json_each(?))
     SELECT ft.file_id AS id, sum(weighted.weight) AS score, json_group_array(weighted.name) AS tags
     FROM weighted JOIN tag t ON t.name = weighted.name JOIN file_tag ft ON ft.tag_id = t.id
     WHERE ft.file_id NOT IN (SELECT file_id FROM ruled_out)
     GROUP BY ft.file_id ORDER BY score DESC, ft.file_id LIMIT ?`,
    ...ruledOut.params,
    JSON.stringify(weights),
    limit,
  );
  return rows.map((row) => ({ ...row, tags: (JSON.parse(row.tags) as Tag[]).toSorted() }));
}

/** Files outside the scope whose name holds any of the words, ignoring case. */
export function nameCandidates(
  sql: Sql,
  scope: RefreshScope,
  words: string[],
  limit: number,
): number[] {
  if (words.length === 0) return [];
  const ruledOut = ruledOutFilesCte(scope);
  const lowerFileName = `lower(${fileName('f.path')})`;
  const rows = sql.all<{ id: number }>(
    `WITH ${ruledOut.sql}
     SELECT f.id FROM file f WHERE f.id NOT IN (SELECT file_id FROM ruled_out)
       AND EXISTS (SELECT 1 FROM json_each(?) WHERE instr(${lowerFileName}, value) > 0)
     ORDER BY f.id LIMIT ?`,
    ...ruledOut.params,
    JSON.stringify(words),
    limit,
  );
  return rows.map((row) => row.id);
}

/** Which of these files the scope rules out. */
export function refreshExcluded(sql: Sql, scope: RefreshScope, ids: number[]): Set<number> {
  const ruledOut = ruledOutFilesCte(scope);
  const rows = sql.all<{ file_id: number }>(
    `WITH ${ruledOut.sql} SELECT file_id FROM ruled_out
     WHERE file_id IN (SELECT value FROM json_each(?))`,
    ...ruledOut.params,
    JSON.stringify(ids),
  );
  return new Set(rows.map((row) => row.file_id));
}

/** Files by id as the UI sees them, with the state their last answers were keyed on. */
export function refreshRows(sql: Sql, ids: number[]): (FileRow & { state_hash: string | null })[] {
  if (ids.length === 0) return [];
  const rows = sql.all<RawFileRow & { state_hash: string | null }>(
    `SELECT ${FILE_COLUMNS}, f.state_hash FROM file f
     WHERE f.id IN (SELECT value FROM json_each(?)) ORDER BY f.id`,
    JSON.stringify(ids),
  );
  return rows.map((row) => ({ ...toFileRow(row), state_hash: row.state_hash }));
}
