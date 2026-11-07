/** What a tag refresh reads: the files with a tag, and the signals that point at files without it. */
import type { SQLInputValue } from 'node:sqlite';
import type { FileRow, Tag } from '../../types.ts';
import type { Sql } from './connection.ts';
import { FILE_COLUMNS, type RawFileRow, toFileRow } from './file-query.ts';
import { fileName } from './paths.ts';

/** The tag a refresh spreads, and the single-valued facet whose other values rule a file out. */
export interface RefreshScope {
  tag: Tag;
  /** Set only when the tag is a label of a facet that holds one value per file. */
  facet?: string;
}

/** A SQL fragment and the values of its placeholders, in order. */
interface Clause {
  sql: string;
  params: SQLInputValue[];
}

/** The tag and its children: `/` and the character right after it bound them. */
const tagNames = (tag: Tag): Clause => ({
  sql: '(t.name = ? OR (t.name >= ? AND t.name < ?))',
  params: [tag, `${tag}/`, `${tag}0`],
});

/** Files that have the tag or a child of it. */
function held(tag: Tag): Clause {
  const names = tagNames(tag);
  return {
    sql: `held AS MATERIALIZED (SELECT DISTINCT ft.file_id FROM file_tag ft
            JOIN tag t ON t.id = ft.tag_id WHERE ${names.sql})`,
    params: names.params,
  };
}

/**
 * Files a refresh never proposes the tag for: those that have it, those with any review row for it
 * (open, accepted or rejected), and those with another value of its single-valued facet.
 */
function excluded({ tag, facet }: RefreshScope): Clause {
  const names = tagNames(tag);
  const facetRange = facet ? [`${facet}:`, `${facet};`] : [null, null];
  return {
    sql: `excluded AS MATERIALIZED (
            SELECT ft.file_id FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
            WHERE ${names.sql} OR (t.name >= ? AND t.name < ?)
            UNION SELECT file_id FROM review WHERE kind = 'suggest' AND tag = ?)`,
    params: [...names.params, ...facetRange, tag],
  };
}

/** Files with the tag, the most recently modified first, and how many there are in all. */
export function refreshSeeds(sql: Sql, tag: Tag, limit: number): { ids: number[]; total: number } {
  const scope = held(tag);
  const ids = sql
    .all<{ id: number }>(
      `WITH ${scope.sql} SELECT f.id FROM file f JOIN held h ON h.file_id = f.id
       ORDER BY CAST(f.mtime_ns AS INTEGER) DESC, f.id DESC LIMIT ?`,
      ...scope.params,
      limit,
    )
    .map((row) => row.id);
  const { n } = sql.get<{ n: number }>(
    `WITH ${scope.sql} SELECT count(*) AS n FROM held`,
    ...scope.params,
  )!;
  return { ids, total: n };
}

/** A tag seen on files that have the refreshed tag. `df` is counted now, not read from `tag`. */
export interface CoTagCount {
  tag: Tag;
  weight: number;
  /** Files with this tag. */
  df: number;
  /** Files with both tags. */
  co: number;
}

/** Every other tag on files with the tag, and the counts lift and IDF need. */
export function coTagCounts(sql: Sql, tag: Tag): { files: number; rows: CoTagCount[] } {
  const scope = held(tag);
  const names = tagNames(tag);
  const rows = sql.all<CoTagCount>(
    `WITH ${scope.sql}
     SELECT t.name AS tag, t.weight, count(*) AS co,
       (SELECT count(*) FROM file_tag d WHERE d.tag_id = t.id) AS df
     FROM held h JOIN file_tag ft ON ft.file_id = h.file_id JOIN tag t ON t.id = ft.tag_id
     WHERE NOT ${names.sql} AND t.weight > 0
     GROUP BY t.id ORDER BY t.name`,
    ...scope.params,
    ...names.params,
  );
  const { n } = sql.get<{ n: number }>('SELECT count(*) AS n FROM file')!;
  return { files: n, rows };
}

/** A term as an FTS5 string. Callers pass letters and digits only, so this is belt and braces. */
const ftsString = (term: string) => `"${term.replaceAll('"', '""')}"`;

/** How many searchable texts there are, and how many hold each term. */
export function contentFrequencies(
  sql: Sql,
  terms: string[],
): { docs: number; df: Map<string, number> } {
  const { docs } = sql.get<{ docs: number }>('SELECT count(*) AS docs FROM content')!;
  const df = new Map(
    terms.map((term) => {
      const row = sql.get<{ n: number }>(
        'SELECT count(*) AS n FROM content WHERE content MATCH ?',
        ftsString(term),
      )!;
      return [term, row.n] as const;
    }),
  );
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
  const out = excluded(scope);
  return sql.all(
    `WITH ${out.sql}
     SELECT rowid AS id, rank FROM content WHERE content MATCH ?
       AND rowid NOT IN (SELECT file_id FROM excluded)
     ORDER BY rank, rowid LIMIT ?`,
    ...out.params,
    terms.map(ftsString).join(' OR '),
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
  const out = excluded(scope);
  return sql
    .all<{ id: number; score: number; tags: string }>(
      `WITH ${out.sql},
         w AS (SELECT json_extract(value, '$[0]') AS name, json_extract(value, '$[1]') AS w
               FROM json_each(?))
       SELECT ft.file_id AS id, sum(w.w) AS score, json_group_array(w.name) AS tags
       FROM w JOIN tag t ON t.name = w.name JOIN file_tag ft ON ft.tag_id = t.id
       WHERE ft.file_id NOT IN (SELECT file_id FROM excluded)
       GROUP BY ft.file_id ORDER BY score DESC, ft.file_id LIMIT ?`,
      ...out.params,
      JSON.stringify(weights),
      limit,
    )
    .map((row) => ({ ...row, tags: (JSON.parse(row.tags) as Tag[]).toSorted() }));
}

/** Files outside the scope whose name holds any of the words, ignoring case. */
export function nameCandidates(
  sql: Sql,
  scope: RefreshScope,
  words: string[],
  limit: number,
): number[] {
  if (words.length === 0) return [];
  const out = excluded(scope);
  return sql
    .all<{ id: number }>(
      `WITH ${out.sql}
       SELECT f.id FROM file f WHERE f.id NOT IN (SELECT file_id FROM excluded)
         AND EXISTS (SELECT 1 FROM json_each(?) WHERE instr(lower(${fileName('f.path')}), value) > 0)
       ORDER BY f.id LIMIT ?`,
      ...out.params,
      JSON.stringify(words),
      limit,
    )
    .map((row) => row.id);
}

/** Which of these files the scope rules out. */
export function refreshExcluded(sql: Sql, scope: RefreshScope, ids: number[]): Set<number> {
  const out = excluded(scope);
  const rows = sql.all<{ file_id: number }>(
    `WITH ${out.sql} SELECT file_id FROM excluded
     WHERE file_id IN (SELECT value FROM json_each(?))`,
    ...out.params,
    JSON.stringify(ids),
  );
  return new Set(rows.map((row) => row.file_id));
}

/** Files by id as the UI sees them, with the state their last answers were keyed on. */
export function refreshRows(sql: Sql, ids: number[]): (FileRow & { state_hash: string | null })[] {
  if (ids.length === 0) return [];
  return sql
    .all<RawFileRow & { state_hash: string | null }>(
      `SELECT ${FILE_COLUMNS}, f.state_hash FROM file f
       WHERE f.id IN (SELECT value FROM json_each(?)) ORDER BY f.id`,
      JSON.stringify(ids),
    )
    .map((row) => ({ ...toFileRow(row), state_hash: row.state_hash }));
}
