/** The `file` table, and the searchable text beside it. */
import type { FileDetail, FileRow } from '../../types.ts';
import { fileAnswers } from './answers.ts';
import type { Sql } from './connection.ts';
import { FILE_COLUMNS, type RawFileRow, toFileRow } from './file-query.ts';
import { folderRange } from './paths.ts';
import { reviewsForFile } from './reviews.ts';

/** What a scan compares. Decimal strings, since these values do not fit a 64-bit float. */
export interface Fingerprint {
  path: string;
  dev: string;
  ino: string;
  size: number;
  mtime_ns: string;
  ctime_ns: string;
}

/** A `file` row, as stored. */
export interface FileRecord extends Fingerprint {
  id: number;
  hash: string | null;
  state_hash: string | null;
  mime: string | null;
  metadata: string | null;
  status: FileRow['status'];
  tag_w: number;
  error: string | null;
}

/**
 * Inserts a file or updates its fingerprint, and returns its id. `edited` means the content may
 * differ: status goes back to `new` and the hashes are cleared, as they no longer describe it.
 */
export function upsertFile(
  sql: Sql,
  file: Fingerprint,
  options: { edited: boolean; mime?: string | null },
): number {
  const reset = options.edited
    ? `, status = 'new', hash = NULL, state_hash = NULL, error = NULL`
    : '';
  return sql.get<{ id: number }>(
    `INSERT INTO file (path, dev, ino, size, mtime_ns, ctime_ns, mime)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET dev = excluded.dev, ino = excluded.ino,
       size = excluded.size, mtime_ns = excluded.mtime_ns, ctime_ns = excluded.ctime_ns,
       mime = coalesce(mime, excluded.mime)${reset}
     RETURNING id`,
    file.path,
    file.dev,
    file.ino,
    file.size,
    file.mtime_ns,
    file.ctime_ns,
    options.mime ?? null,
  )!.id;
}

/** The stored row, with its fingerprint, for a path. */
export const fileByPath = (sql: Sql, path: string) =>
  sql.get<FileRecord>('SELECT * FROM file WHERE path = ?', path);

/** The stored row for an id. */
export const fileById = (sql: Sql, id: number) =>
  sql.get<FileRecord>('SELECT * FROM file WHERE id = ?', id);

/** Rows on an inode: more than one for hard links. Finds a file that moved. */
export const filesByInode = (sql: Sql, dev: string, ino: string) =>
  sql.all<FileRecord>('SELECT * FROM file WHERE dev = ? AND ino = ?', dev, ino);

/** Points a row at a new path. Tags, answers and history stay. */
export function moveFile(sql: Sql, id: number, path: string): void {
  sql.run('UPDATE file SET path = ? WHERE id = ?', path, id);
}

/** Deletes a file's row and all that hangs off it. `answer` rows stay: they cost money. */
export function deleteFile(sql: Sql, id: number): void {
  sql.transaction(() => {
    // Row ids get reused, so anything left behind would attach to a future file.
    sql.run('DELETE FROM file_tag WHERE file_id = ?', id);
    sql.run('DELETE FROM file_answer WHERE file_id = ?', id);
    sql.run('DELETE FROM review WHERE file_id = ?', id);
    sql.run('DELETE FROM content WHERE rowid = ?', id);
    sql.run('DELETE FROM file WHERE id = ?', id);
  });
}

/** Id and path of every file below a folder. */
export function filesUnder(sql: Sql, folder: string): { id: number; path: string }[] {
  return sql.all(`SELECT id, path FROM file WHERE path >= ? AND path < ?`, ...folderRange(folder));
}

/** Records what organize found. A field left out keeps its stored value. */
export function setFileResult(
  sql: Sql,
  id: number,
  result: {
    status: FileRow['status'];
    error?: string;
    hash?: string;
    state_hash?: string;
    mime?: string;
    metadata?: FileDetail['metadata'];
  },
): void {
  sql.run(
    `UPDATE file SET status = ?, error = ?, hash = coalesce(?, hash),
       state_hash = coalesce(?, state_hash), mime = coalesce(?, mime),
       metadata = coalesce(?, metadata)
     WHERE id = ?`,
    result.status,
    result.error ?? null,
    result.hash ?? null,
    result.state_hash ?? null,
    result.mime ?? null,
    result.metadata ? JSON.stringify(result.metadata) : null,
    id,
  );
}

/** One file as the UI sees it. */
export function fileRow(sql: Sql, id: number): FileRow | undefined {
  const row = sql.get<RawFileRow>(`SELECT ${FILE_COLUMNS} FROM file f WHERE f.id = ?`, id);
  return row && toFileRow(row);
}

/** Everything the inspector shows, but `taggable`, which needs the disk. */
export function fileDetail(sql: Sql, id: number): Omit<FileDetail, 'taggable'> | undefined {
  const row = fileRow(sql, id);
  if (!row) return undefined;
  const { metadata } = sql.get<{ metadata: string | null }>(
    'SELECT metadata FROM file WHERE id = ?',
    id,
  )!;
  return {
    ...row,
    metadata: metadata ? (JSON.parse(metadata) as FileDetail['metadata']) : {},
    answers: fileAnswers(sql, id),
    reviews: reviewsForFile(sql, id),
  };
}

/** Replaces the searchable text of a file. */
export function setContent(sql: Sql, fileId: number, text: string): void {
  sql.transaction(() => {
    sql.run('DELETE FROM content WHERE rowid = ?', fileId);
    sql.run('INSERT INTO content (rowid, text) VALUES (?, ?)', fileId, text);
  });
}

/** The searchable text of a file. */
export function getContent(sql: Sql, fileId: number): string | undefined {
  return sql.get<{ text: string }>('SELECT text FROM content WHERE rowid = ?', fileId)?.text;
}
