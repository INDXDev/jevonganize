/**
 * What the tag tree reads: each file's tags, which it counts under every node at once, the tags
 * under one tag, by the same name range search uses, and parents carried beside their children.
 * See docs/tags.md#hierarchy.
 */
import type { Tag } from '../../types.ts';
import type { Sql } from './connection.ts';
import { folderRange } from './paths.ts';
import { childBounds } from './tag-filter.ts';

/** A tag on one file. */
export interface TagOnFile {
  tag: Tag;
  file_id: number;
}

/** Every tag row by id, those on no file included. */
export function tagNames(sql: Sql): Map<number, Tag> {
  const rows = sql.all<{ id: number; name: Tag }>('SELECT id, name FROM tag');
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The ids of each file's tags, one comma-joined string per tagged file, within `folder` when given.
 * One pass over the index, so a tree can count distinct files under every node at once.
 */
export function tagIdsByFile(sql: Sql, folder?: string): string[] {
  // Joining `file` costs a lookup per row, so it is only added for a folder.
  const fileJoin = folder ? 'JOIN file f ON f.id = ft.file_id AND f.path >= ? AND f.path < ?' : '';
  const rows = sql.all<{ ids: string }>(
    `SELECT group_concat(ft.tag_id) AS ids FROM file_tag ft ${fileJoin} GROUP BY ft.file_id`,
    ...(folder ? folderRange(folder) : []),
  );
  return rows.map((row) => row.ids);
}

/** Every file carrying `path` or a tag under it, with that tag, by file and then name. */
export function subtreeTags(sql: Sql, path: Tag): TagOnFile[] {
  return sql.all<TagOnFile>(
    `SELECT t.name AS tag, ft.file_id FROM tag t JOIN file_tag ft ON ft.tag_id = t.id
     WHERE t.name = ? OR (t.name >= ? AND t.name < ?) ORDER BY ft.file_id, t.name`,
    path,
    ...childBounds(path),
  );
}

/** Pairs of a tag and an ancestor of it on the same files, most files first. */
export function redundantParents(sql: Sql): { tag: Tag; parent: Tag; files: number }[] {
  // `||` binds tighter than a comparison, so each bound is the parent's name with a suffix.
  return sql.all(
    `SELECT c.name AS tag, p.name AS parent, count(*) AS files
     FROM tag c JOIN file_tag fc ON fc.tag_id = c.id
     JOIN file_tag fp ON fp.file_id = fc.file_id
     JOIN tag p ON p.id = fp.tag_id
     WHERE instr(c.name, '/') > 0 AND c.name >= p.name || '/' AND c.name < p.name || '0'
     GROUP BY c.id, p.id ORDER BY files DESC, c.name, p.name`,
  );
}
