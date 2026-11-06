/** Items waiting for a person, and the tombstones of rejected tags. */
import type { ReviewItem, Tag } from '../../types.ts';
import type { Sql } from './connection.ts';

const REVIEW_COLUMNS = 'id, file_id, kind, tag, confidence, reason';

/** Adds an open item. An existing row, rejected ones included, stays. True if it was added. */
export function addReview(sql: Sql, item: Omit<ReviewItem, 'id'>): boolean {
  const { changes } = sql.run(
    `INSERT OR IGNORE INTO review (file_id, kind, tag, confidence, reason)
     VALUES (?, ?, ?, ?, ?)`,
    item.file_id,
    item.kind,
    item.tag,
    item.confidence,
    item.reason,
  );
  return changes > 0;
}

/** Open items, by tag and then highest confidence, optionally for one tag. */
export function listReviews(sql: Sql, filter: { tag?: Tag; limit?: number } = {}): ReviewItem[] {
  const byTag = filter.tag === undefined ? '' : 'AND tag = ?';
  return sql.all(
    `SELECT ${REVIEW_COLUMNS} FROM review WHERE state = 'open' ${byTag}
     ORDER BY tag, confidence DESC NULLS LAST, id LIMIT ?`,
    ...(filter.tag === undefined ? [] : [filter.tag]),
    filter.limit ?? -1,
  );
}

/** Open items for one file. */
export function reviewsForFile(sql: Sql, fileId: number): ReviewItem[] {
  return sql.all(
    `SELECT ${REVIEW_COLUMNS} FROM review WHERE file_id = ? AND state = 'open' ORDER BY tag`,
    fileId,
  );
}

/** Items by id, whatever their state. */
export function reviewsByIds(sql: Sql, ids: number[]): ReviewItem[] {
  return ids.flatMap(
    (id) => sql.get<ReviewItem>(`SELECT ${REVIEW_COLUMNS} FROM review WHERE id = ?`, id) ?? [],
  );
}

/** Closes items. A rejected `suggest` stays as a tombstone. A `restore` goes, so it can recur. */
export function resolveReviews(sql: Sql, ids: number[], state: 'accepted' | 'rejected'): void {
  sql.transaction(() => {
    for (const id of ids) {
      sql.run(`DELETE FROM review WHERE id = ? AND kind = 'restore'`, id);
      sql.run('UPDATE review SET state = ? WHERE id = ?', state, id);
    }
  });
}

/** Stores a tombstone, so `resolve` never brings this tag back to this file. */
export function rejectTag(sql: Sql, fileId: number, tag: Tag, reason: string): void {
  sql.run(
    `INSERT INTO review (file_id, kind, tag, reason, state) VALUES (?, 'suggest', ?, ?, 'rejected')
     ON CONFLICT (file_id, kind, tag) DO UPDATE SET state = 'rejected'`,
    fileId,
    tag,
    reason,
  );
}

/** Lifts a tombstone: a person put this tag back. */
export function unrejectTag(sql: Sql, fileId: number, tag: Tag): void {
  sql.run(
    `DELETE FROM review WHERE file_id = ? AND tag = ? AND kind = 'suggest' AND state = 'rejected'`,
    fileId,
    tag,
  );
}

/** Tags that must not come back to this file. */
export function rejectedTags(sql: Sql, fileId: number): Tag[] {
  return sql
    .all<{ tag: Tag }>(
      `SELECT tag FROM review WHERE file_id = ? AND state = 'rejected' ORDER BY tag`,
      fileId,
    )
    .map((row) => row.tag);
}

/** Drops `restore` items whose tag is back on the file. */
export function dropRestored(sql: Sql, fileId: number, tags: Tag[]): void {
  for (const tag of tags) {
    sql.run(`DELETE FROM review WHERE file_id = ? AND kind = 'restore' AND tag = ?`, fileId, tag);
  }
}
