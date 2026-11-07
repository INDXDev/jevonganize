/** Tag statistics for suggesting virtual folders and the tags of their rules. Reads only. */
import type { FileQuery, Tag } from '../../types.ts';
import type { Sql } from './connection.ts';
import { compileQuery } from './file-query.ts';

/** A tag in use, with how many files carry it overall and among the files a rule matches. */
export interface RuleTagRow {
  tag: Tag;
  facet: string | null;
  idf: number;
  /** Every file carrying the tag. */
  count: number;
  /** The files the rule matches that carry it. */
  with_rule: number;
}

/** A tag's facet and how many files carry it. */
export interface TagStatRow {
  tag: Tag;
  facet: string | null;
  count: number;
}

/** Two tags carried by the same files, with each one's own count. */
export interface TagPairRow {
  first: Tag;
  second: Tag;
  together: number;
  first_count: number;
  second_count: number;
}

/** Every tag carried by a file the query matches, with its counts there and everywhere. */
export function ruleTagCounts(sql: Sql, query: FileQuery): RuleTagRow[] {
  const { contentCte, fromWhere, params } = compileQuery(query);
  return sql.all<RuleTagRow>(
    `${contentCte} SELECT t.name AS tag, t.facet, t.idf, count(*) AS with_rule,
       (SELECT count(*) FROM file_tag c WHERE c.tag_id = t.id) AS count
     FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
     WHERE ft.file_id IN (SELECT f.id ${fromWhere})
     GROUP BY t.id ORDER BY t.name`,
    ...params,
  );
}

/** The facet and file count of each of these tags that some file carries. */
export function tagStats(sql: Sql, tags: Tag[]): TagStatRow[] {
  if (tags.length === 0) return [];
  return sql.all<TagStatRow>(
    `SELECT t.name AS tag, t.facet, count(ft.file_id) AS count
     FROM tag t LEFT JOIN file_tag ft ON ft.tag_id = t.id
     WHERE t.name IN (SELECT value FROM json_each(?))
     GROUP BY t.id ORDER BY t.name`,
    JSON.stringify(tags),
  );
}

/**
 * Pairs among the `top` most used tags that at least `minTogether` files carry together, most shared
 * first. Bounding the tags keeps the self-join cheap on a large index.
 */
export function tagPairs(sql: Sql, top: number, minTogether: number): TagPairRow[] {
  return sql.all<TagPairRow>(
    `WITH top_tag AS MATERIALIZED (
       SELECT tag_id, count(*) AS n FROM file_tag GROUP BY tag_id ORDER BY n DESC, tag_id LIMIT ?)
     SELECT a.name AS first, b.name AS second, count(*) AS together,
       ta.n AS first_count, tb.n AS second_count
     FROM file_tag x JOIN top_tag ta ON ta.tag_id = x.tag_id
     JOIN file_tag y ON y.file_id = x.file_id
     JOIN top_tag tb ON tb.tag_id = y.tag_id
     JOIN tag a ON a.id = x.tag_id JOIN tag b ON b.id = y.tag_id
     WHERE a.name < b.name
     GROUP BY x.tag_id, y.tag_id HAVING count(*) >= ?
     ORDER BY together DESC, first, second`,
    top,
    minTogether,
  );
}
