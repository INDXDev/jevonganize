/** The tag mirror, and the numbers similarity reads. */
import type { SQLInputValue } from 'node:sqlite';
import type { Tag, TagCount } from '../../types.ts';
import type { Sql } from './connection.ts';
import { folderRange } from './paths.ts';

/** A tag in the mirror, and whether the app wrote it. */
export interface MirrorTag {
  tag: Tag;
  ai: boolean;
}

/** The mirror for one file, sorted. */
export function fileTags(sql: Sql, fileId: number): MirrorTag[] {
  return sql
    .all<{ tag: Tag; ai: number }>(
      `SELECT t.name AS tag, ft.ai FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
       WHERE ft.file_id = ? ORDER BY t.name`,
      fileId,
    )
    .map(({ tag, ai }) => ({ tag, ai: ai === 1 }));
}

/** Keeps `tag_w` right for one file, using the current `idf`. */
function updateWeight(sql: Sql, fileId: number): void {
  sql.run(
    `UPDATE file SET tag_w = coalesce((SELECT sum(t.idf * t.weight) FROM file_tag ft
       JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = file.id), 0) WHERE id = ?`,
    fileId,
  );
}

/** Adds tags to the mirror, setting `ai` on each. Keeps `tag_w` right. */
export function addFileTags(sql: Sql, fileId: number, tags: Tag[], ai: boolean): void {
  sql.transaction(() => {
    for (const tag of tags) {
      const { id } = sql.get<{ id: number }>(
        `INSERT INTO tag (name) VALUES (?)
         ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`,
        tag,
      )!;
      sql.run(
        `INSERT INTO file_tag (tag_id, file_id, ai) VALUES (?, ?, ?)
         ON CONFLICT (tag_id, file_id) DO UPDATE SET ai = excluded.ai`,
        id,
        fileId,
        ai ? 1 : 0,
      );
    }
    updateWeight(sql, fileId);
  });
}

/** Removes tags from the mirror. Keeps `tag_w` right. */
export function removeFileTags(sql: Sql, fileId: number, tags: Tag[]): void {
  sql.transaction(() => {
    for (const tag of tags) {
      sql.run(
        `DELETE FROM file_tag WHERE file_id = ?
         AND tag_id = (SELECT id FROM tag WHERE name = ?)`,
        fileId,
        tag,
      );
    }
    updateWeight(sql, fileId);
  });
}

/**
 * Makes the mirror equal the disk. A tag that stays keeps its `ai` flag, and a new one is human.
 * Returns the difference, so a scan can tell what a person removed.
 */
export function syncFileTags(
  sql: Sql,
  fileId: number,
  tags: Tag[],
): { added: Tag[]; removed: MirrorTag[] } {
  const current = fileTags(sql, fileId);
  const known = new Set(current.map((row) => row.tag));
  const wanted = new Set(tags);
  const added = tags.filter((tag) => !known.has(tag));
  const removed = current.filter((row) => !wanted.has(row.tag));
  if (added.length || removed.length) {
    sql.transaction(() => {
      removeFileTags(
        sql,
        fileId,
        removed.map((row) => row.tag),
      );
      addFileTags(sql, fileId, added, false);
    });
  }
  return { added, removed };
}

/** Ids of files carrying exactly this tag, children excluded. */
export function filesWithTag(sql: Sql, tag: Tag): number[] {
  return sql
    .all<{ file_id: number }>(
      `SELECT file_id FROM file_tag WHERE tag_id = (SELECT id FROM tag WHERE name = ?)`,
      tag,
    )
    .map((row) => row.file_id);
}

/** Tags in use, most used first, optionally within a folder or a facet. */
export function tagCounts(sql: Sql, filter: { folder?: string; facet?: string } = {}): TagCount[] {
  const where = ['1'];
  const params: SQLInputValue[] = [];
  let files = '';
  if (filter.folder) {
    files = 'JOIN file f ON f.id = ft.file_id'; // a join on every tag row, so only when asked
    where.push('f.path >= ? AND f.path < ?');
    params.push(...folderRange(filter.folder));
  }
  if (filter.facet) {
    where.push('t.facet = ?');
    params.push(filter.facet);
  }
  return sql.all(
    `SELECT t.name AS tag, t.facet, count(*) AS count FROM file_tag ft
     JOIN tag t ON t.id = ft.tag_id ${files}
     WHERE ${where.join(' AND ')} GROUP BY t.id ORDER BY count DESC, t.name`,
    ...params,
  );
}

/**
 * Stamps each tag with its facet and similarity weight. Only a caller holding the facets knows
 * which prefixes are facets, so run this after loading them and before `refreshIdf`.
 */
export function setTagFacets(sql: Sql, facets: { id: string; weight: number }[]): void {
  sql.transaction(() => {
    for (const { id, weight } of facets) {
      // `;` is the character right after `:`.
      sql.run(
        `UPDATE tag SET facet = ?, weight = ? WHERE (name >= ? AND name < ?) OR name = ?`,
        id,
        weight,
        `${id}:`,
        `${id};`,
        `flag:${id}`,
      );
    }
  });
}

/** Recomputes `df`, `idf` and every `tag_w`. Runs after each scan. */
export function refreshIdf(sql: Sql): void {
  sql.transaction(() => {
    const { n } = sql.get<{ n: number }>('SELECT count(*) AS n FROM file')!;
    sql.run('UPDATE tag SET df = (SELECT count(*) FROM file_tag WHERE tag_id = tag.id)');
    sql.run('UPDATE tag SET idf = ln(1 + (? - df + 0.5) / (df + 0.5))', n);
    sql.run(`UPDATE file SET tag_w = coalesce((SELECT sum(t.idf * t.weight) FROM file_tag ft
           JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = file.id), 0)`);
  });
}
