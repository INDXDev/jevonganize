/** Read-only questions across the index: search, folders, similarity and totals. */
import { sep } from 'node:path';
import type { FileQuery, FileRow, FolderCount, SimilarFile, Tag } from '../../types.ts';
import type { Sql } from './connection.ts';
import { compileQuery, FILE_COLUMNS, orderBy, type RawFileRow, toFileRow } from './file-query.ts';
import { type FileRecord, fileRow } from './files.ts';
import { folderRange } from './paths.ts';

/** Runs a `FileQuery`. Without `limit` it returns every match, so callers bound what they show. */
export function searchFiles(sql: Sql, query: FileQuery): { files: FileRow[]; total: number } {
  const { matches, from, params, ranked } = compileQuery(query);
  const { n } = sql.get<{ n: number }>(`${matches} SELECT count(*) AS n ${from}`, ...params)!;
  const rows = sql.all<RawFileRow>(
    `${matches} SELECT ${FILE_COLUMNS} ${from}
     ORDER BY ${orderBy(query, ranked)} LIMIT ? OFFSET ?`,
    ...params,
    query.limit ?? -1,
    query.offset ?? 0,
  );
  return { files: rows.map(toFileRow), total: n };
}

/** The folders directly under `folder` that hold indexed files, by name. */
export function folderCounts(sql: Sql, folder: string): FolderCount[] {
  const [from, to] = folderRange(folder);
  return sql
    .all<Omit<FolderCount, 'path'>>(
      `SELECT substr(rest, 1, instr(rest, ?) - 1) AS name, count(*) AS files
       FROM (SELECT substr(path, length(?) + 1) AS rest FROM file WHERE path >= ? AND path < ?)
       WHERE instr(rest, ?) > 0 GROUP BY name ORDER BY name COLLATE NOCASE`,
      sep,
      from,
      from,
      to,
      sep,
    )
    .map((row) => ({ ...row, path: from + row.name }));
}

/** What `estimate` reads of a `FileQuery`, without the cost of every file's tags. */
export function fileStates(sql: Sql, query: FileQuery) {
  const { matches, from, params, ranked } = compileQuery(query);
  return sql.all<Pick<FileRecord, 'id' | 'size' | 'mime' | 'state_hash'>>(
    `${matches} SELECT f.id, f.size, f.mime, f.state_hash ${from}
     ORDER BY ${orderBy(query, ranked)} LIMIT ? OFFSET ?`,
    ...params,
    query.limit ?? -1,
    query.offset ?? 0,
  );
}

/** Files most like this one, by IDF-weighted Jaccard. See docs/storage.md. */
export function similarFiles(sql: Sql, id: number, limit = 20): SimilarFile[] {
  const hits = sql.all<{ file_id: number; score: number }>(
    `WITH q AS (SELECT ft.tag_id, t.idf * t.weight AS w FROM file_tag ft
                JOIN tag t ON t.id = ft.tag_id
                WHERE ft.file_id = ?1 AND t.weight > 0),
          total AS (SELECT sum(w) AS s FROM q),
          hits AS (SELECT ft.file_id, sum(q.w) AS shared FROM q
                   JOIN file_tag ft ON ft.tag_id = q.tag_id
                   WHERE ft.file_id <> ?1 GROUP BY ft.file_id)
     SELECT h.file_id, h.shared / (total.s + f.tag_w - h.shared) AS score
     FROM hits h JOIN file f ON f.id = h.file_id, total
     WHERE total.s + f.tag_w - h.shared > 0
     ORDER BY score DESC, h.file_id LIMIT ?2`,
    id,
    limit,
  );
  const mine = new Set(
    sql
      .all<{ name: Tag }>(
        `SELECT t.name FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
         WHERE ft.file_id = ? AND t.weight > 0`,
        id,
      )
      .map((row) => row.name),
  );
  return hits.map(({ file_id, score }) => {
    const row = fileRow(sql, file_id)!;
    return { ...row, score, shared: row.tags.filter((tag) => mine.has(tag)) };
  });
}

/** Counts across the index, for `status`. */
export function stats(sql: Sql) {
  return sql.get<{ files: number; organized: number; tags: number; reviews: number }>(
    `SELECT (SELECT count(*) FROM file) AS files,
       (SELECT count(*) FROM file WHERE status = 'organized') AS organized,
       (SELECT count(DISTINCT tag_id) FROM file_tag) AS tags,
       (SELECT count(*) FROM review WHERE state = 'open') AS reviews`,
  )!;
}
