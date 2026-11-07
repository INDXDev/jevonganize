/** Read-only questions across the index: search, folders, similarity and totals. */
import { sep } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import type { FileQuery, FileRow, FolderCount, SimilarFile, Tag } from '../../types.ts';
import type { Sql } from './connection.ts';
import {
  type CompiledQuery,
  compileQuery,
  FILE_COLUMNS,
  orderBy,
  type RawFileRow,
  toFileRow,
} from './file-query.ts';
import type { FileRecord } from './files.ts';
import { folderRange } from './paths.ts';

/** How many files a compiled query matches, from the total cache when it can. */
function cachedTotal(sql: Sql, { contentCte, fromWhere, params }: CompiledQuery): number {
  const countSql = `${contentCte} SELECT count(*) AS n ${fromWhere}`;
  const cacheKey = JSON.stringify([countSql, params]);
  return sql.cachedCount(cacheKey, () => sql.get<{ n: number }>(countSql, ...params)!.n);
}

/** The `LIMIT` and `OFFSET` values of a query. A limit of -1 is SQLite's "no limit". */
const pageParams = (query: FileQuery): SQLInputValue[] => [query.limit ?? -1, query.offset ?? 0];

/** How many files a `FileQuery` matches, ignoring its paging. Shares the total cache with search. */
export const countFiles = (sql: Sql, query: FileQuery): number =>
  cachedTotal(sql, compileQuery(query));

/** Filters, sorts and pages in one pass, filling in every row it walks past. */
function pageInOnePass({ contentCte, fromWhere }: CompiledQuery, order: string): string {
  return `${contentCte} SELECT ${FILE_COLUMNS} ${fromWhere} ORDER BY ${order} LIMIT ? OFFSET ?`;
}

/** Picks the page by id first, then fills in only its rows. */
function pageByIdFirst({ contentCte, fromWhere, ranked }: CompiledQuery, order: string): string {
  const withKeyword = contentCte ? `${contentCte},` : 'WITH';
  const rankColumn = ranked ? ', hit.rank' : '';
  // Outside the page CTE, `hit` is out of scope and the rank is the copy the page kept.
  const outerOrder = order.replaceAll('hit.rank', 'page.rank');
  return `${withKeyword} page AS MATERIALIZED (
       SELECT f.id${rankColumn} ${fromWhere}
       ORDER BY ${order} LIMIT ? OFFSET ?)
     SELECT ${FILE_COLUMNS} FROM page JOIN file f ON f.id = page.id
     ORDER BY ${outerOrder}`;
}

/**
 * The statement for one page of full rows. `FILE_COLUMNS` gathers every file's tags, which costs
 * the most, so a sort that cannot walk the `file_name` index picks its page first. A name sort
 * walks the index and stops at the limit by itself.
 */
function pageStatement(query: FileQuery, compiled: CompiledQuery): string {
  const order = orderBy(query, compiled.ranked);
  const sortsByName = query.sort === 'name' || (!compiled.ranked && query.sort === undefined);
  const isPaged = query.limit !== undefined;
  return isPaged && !sortsByName ? pageByIdFirst(compiled, order) : pageInOnePass(compiled, order);
}

/** Runs a `FileQuery`. Without `limit` it returns every match, so callers bound what they show. */
export function searchFiles(sql: Sql, query: FileQuery): { files: FileRow[]; total: number } {
  const compiled = compileQuery(query);
  const total = cachedTotal(sql, compiled);
  const statement = pageStatement(query, compiled);
  const rows = sql.all<RawFileRow>(statement, ...compiled.params, ...pageParams(query));
  return { files: rows.map(toFileRow), total };
}

/** The folders directly under `folder` that hold indexed files, by name. */
export function folderCounts(sql: Sql, folder: string): FolderCount[] {
  const [start, end] = folderRange(folder);
  // `rest` is each path below the folder; only those with a separator left are in a subfolder.
  const rows = sql.all<Omit<FolderCount, 'path'>>(
    `SELECT substr(rest, 1, instr(rest, ?) - 1) AS name, count(*) AS files
     FROM (SELECT substr(path, length(?) + 1) AS rest FROM file WHERE path >= ? AND path < ?)
     WHERE instr(rest, ?) > 0 GROUP BY name ORDER BY name COLLATE NOCASE`,
    sep,
    start,
    start,
    end,
    sep,
  );
  return rows.map((row) => ({ ...row, path: start + row.name }));
}

/** Some columns of every file a query matches, in its order and paging. */
function selectMatching<Row>(sql: Sql, query: FileQuery, columns: string): Row[] {
  const { contentCte, fromWhere, params, ranked } = compileQuery(query);
  const order = orderBy(query, ranked);
  return sql.all<Row>(
    `${contentCte} SELECT ${columns} ${fromWhere} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    ...pageParams(query),
  );
}

/** What `estimate` reads of a `FileQuery`, without the cost of every file's tags. */
export const fileStates = (sql: Sql, query: FileQuery) =>
  selectMatching<Pick<FileRecord, 'id' | 'size' | 'mime' | 'state_hash'>>(
    sql,
    query,
    'f.id, f.size, f.mime, f.state_hash',
  );

/** Which files a `FileQuery` matches, without the cost of every file's tags. */
export const fileRefs = (sql: Sql, query: FileQuery) =>
  selectMatching<Pick<FileRow, 'id' | 'path'>>(sql, query, 'f.id, f.path');

/** The weight of the union of both files' tags: their totals less the shared part. */
const UNION_WEIGHT = 'source.total_weight + f.tag_w - overlap.shared';

/**
 * The files sharing a weighted tag with this one, scored by weighted Jaccard: the shared weight
 * over the weight of the union. `f.tag_w` is each file's stored total.
 */
function similarityScores(sql: Sql, sourceId: number, limit: number) {
  return sql.all<{ file_id: number; score: number }>(
    `WITH source_tag AS (SELECT ft.tag_id, t.idf * t.weight AS weight FROM file_tag ft
                         JOIN tag t ON t.id = ft.tag_id
                         WHERE ft.file_id = ?1 AND t.weight > 0),
          source AS (SELECT sum(weight) AS total_weight FROM source_tag),
          overlap AS (SELECT ft.file_id, sum(source_tag.weight) AS shared FROM source_tag
                      JOIN file_tag ft ON ft.tag_id = source_tag.tag_id
                      WHERE ft.file_id <> ?1 GROUP BY ft.file_id)
     SELECT overlap.file_id, overlap.shared / (${UNION_WEIGHT}) AS score
     FROM overlap JOIN file f ON f.id = overlap.file_id, source
     WHERE ${UNION_WEIGHT} > 0
     ORDER BY score DESC, overlap.file_id LIMIT ?2`,
    sourceId,
    limit,
  );
}

/** The tags of a file that count towards similarity. */
function weightedTags(sql: Sql, fileId: number): Set<Tag> {
  const rows = sql.all<{ name: Tag }>(
    `SELECT t.name FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
     WHERE ft.file_id = ? AND t.weight > 0`,
    fileId,
  );
  return new Set(rows.map((row) => row.name));
}

/** Files most like this one, by IDF-weighted Jaccard. See docs/storage.md. */
export function similarFiles(sql: Sql, sourceId: number, limit = 20): SimilarFile[] {
  const scores = similarityScores(sql, sourceId, limit);
  if (scores.length === 0) return [];
  const sourceTags = weightedTags(sql, sourceId);
  const rows = sql.all<RawFileRow>(
    `SELECT ${FILE_COLUMNS} FROM file f WHERE f.id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(scores.map((scored) => scored.file_id)),
  );
  const filesById = new Map(rows.map((row) => [row.id, toFileRow(row)]));
  return scores.map(({ file_id, score }) => {
    const similar = filesById.get(file_id)!;
    const shared = similar.tags.filter((tag) => sourceTags.has(tag));
    return { ...similar, score, shared };
  });
}

/** Counts across the index, for `status`: files, organized files, tags in use, open reviews. */
export function stats(sql: Sql) {
  return sql.get<{ files: number; organized: number; tags: number; reviews: number }>(
    `SELECT (SELECT count(*) FROM file) AS files,
       (SELECT count(*) FROM file WHERE status = 'organized') AS organized,
       (SELECT count(DISTINCT tag_id) FROM file_tag) AS tags,
       (SELECT count(*) FROM review WHERE state = 'open') AS reviews`,
  )!;
}
