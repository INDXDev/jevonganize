/**
 * The scope of a tag refresh, as CTEs for its queries: `tagged` holds the files with the tag, and
 * `ruled_out` the files a refresh must never propose it for. Kept apart from `tag-refresh.ts`,
 * whose every export becomes a method of the index.
 */
import type { Tag } from '../../types.ts';
import type { Clause } from './tag-filter.ts';

/** The tag a refresh spreads, and the single-valued facet whose other values rule a file out. */
export interface RefreshScope {
  tag: Tag;
  /** Set only when the tag is a label of a facet that holds one value per file. */
  facet?: string;
}

/** The tag and its children: `/` and the character right after it bound them. */
export const tagOrChildCondition = (tag: Tag): Clause => ({
  sql: '(t.name = ? OR (t.name >= ? AND t.name < ?))',
  params: [tag, `${tag}/`, `${tag}0`],
});

/** The CTE `tagged`: files that have the tag or a child of it. */
export function taggedFilesCte(tag: Tag): Clause {
  const tagOrChild = tagOrChildCondition(tag);
  return {
    sql: `tagged AS MATERIALIZED (SELECT DISTINCT ft.file_id FROM file_tag ft
            JOIN tag t ON t.id = ft.tag_id WHERE ${tagOrChild.sql})`,
    params: tagOrChild.params,
  };
}

/**
 * The CTE `ruled_out`: files that have the tag, those with any review row for it (open, accepted
 * or rejected), and those with another value of its single-valued facet.
 */
export function ruledOutFilesCte({ tag, facet }: RefreshScope): Clause {
  const tagOrChild = tagOrChildCondition(tag);
  // Every `facet:...` name sorts in [`facet:`, `facet;`). Without a facet the range is NULL to
  // NULL, which no name falls in.
  const otherValuesRange = facet ? [`${facet}:`, `${facet};`] : [null, null];
  return {
    sql: `ruled_out AS MATERIALIZED (
            SELECT ft.file_id FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
            WHERE ${tagOrChild.sql} OR (t.name >= ? AND t.name < ?)
            UNION SELECT file_id FROM review WHERE kind = 'suggest' AND tag = ?)`,
    params: [...tagOrChild.params, ...otherValuesRange, tag],
  };
}
