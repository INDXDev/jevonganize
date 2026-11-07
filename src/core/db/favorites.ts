/**
 * Favorite tags: tags a person starred, in the order they chose. Kept by name, not by `tag.id`, so a
 * favorite outlives a tag that no file carries for a while.
 */
import type { FavoriteTag } from '../../tool-map.ts';
import type { Tag } from '../../types.ts';
import type { Sql } from './connection.ts';

/** Every favorite, first position first, with the files carrying exactly that tag now. */
export function listFavoriteTags(sql: Sql): FavoriteTag[] {
  return sql.all<FavoriteTag>(
    `SELECT fav.tag, t.facet,
       (SELECT count(*) FROM file_tag ft WHERE ft.tag_id = t.id) AS count,
       fav.position
     FROM favorite_tag fav LEFT JOIN tag t ON t.name = fav.tag
     ORDER BY fav.position, fav.tag`,
  );
}

/** The favorites' names in order. */
const favoriteNames = (sql: Sql): Tag[] =>
  sql
    .all<{ tag: Tag }>('SELECT tag FROM favorite_tag ORDER BY position, tag')
    .map((row) => row.tag);

/** Stores `order` as positions 0, 1, 2 and so on, keeping each tag's `created_at`. */
function writeOrder(sql: Sql, order: Tag[], now: number): void {
  order.forEach((tag, position) => {
    sql.run(
      `INSERT INTO favorite_tag (tag, position, created_at) VALUES (?, ?, ?)
       ON CONFLICT (tag) DO UPDATE SET position = excluded.position`,
      tag,
      position,
      now,
    );
  });
}

/**
 * Stars or unstars a tag. A star goes at `position`, clamped to the list, or at the end; starring a
 * favorite again with a position moves it. Positions always run from 0 with no gap.
 */
export function setFavoriteTag(
  sql: Sql,
  { tag, favorite, position }: { tag: Tag; favorite: boolean; position?: number },
): void {
  sql.transaction(() => {
    const current = favoriteNames(sql);
    const others = current.filter((name) => name !== tag);
    if (!favorite) {
      sql.run('DELETE FROM favorite_tag WHERE tag = ?', tag);
      writeOrder(sql, others, Date.now());
      return;
    }
    const kept = current.includes(tag) && position === undefined;
    const at = kept ? current.indexOf(tag) : Math.min(position ?? others.length, others.length);
    writeOrder(sql, [...others.slice(0, at), tag, ...others.slice(at)], Date.now());
  });
}

/** Replaces the favorites with `tags`, in that order, keeping the `created_at` of those that stay. */
export function replaceFavoriteTags(sql: Sql, tags: Tag[]): void {
  sql.transaction(() => {
    const keep = new Set(tags);
    for (const name of favoriteNames(sql)) {
      if (!keep.has(name)) sql.run('DELETE FROM favorite_tag WHERE tag = ?', name);
    }
    writeOrder(sql, [...keep], Date.now());
  });
}
