/**
 * The tag conditions of a `FileQuery`, as SQL over `file f`. A tag also matches its children, so
 * `topic:finance` matches `topic:finance/tax`. Every match is a range on the unique index of tag
 * names, bounded by the character right after a separator: `0` after `/`, `.` after `-` and `;`
 * after `:`. That range holds exactly the names with that prefix.
 */
import type { SQLInputValue } from 'node:sqlite';
import type { FileQuery, Tag } from '../../types.ts';

/** A SQL fragment and the values of its placeholders, in order. */
export interface Clause {
  sql: string;
  params: SQLInputValue[];
}

/** A tag whose value is a year, such as `doc-date:2026`, which also owns its months. */
const YEAR_TAG = /^[^:]*:\d{4}$/;

/** The bounds of the names under a tag by `/`: from `tag/` up to, not including, `tag0`. */
export const childBounds = (tag: Tag): [string, string] => [`${tag}/`, `${tag}0`];

/** A subquery of the ids of files carrying a tag or one of its children. */
function filesWithTagOrChild(tag: Tag): Clause {
  const isNamespace = tag.endsWith(':');
  if (isNamespace) {
    const namespaceEnd = `${tag.slice(0, -1)};`;
    return {
      sql: `SELECT file_id FROM file_tag WHERE tag_id IN
        (SELECT id FROM tag WHERE name >= ? AND name < ?)`,
      params: [tag, namespaceEnd],
    };
  }
  const isYear = YEAR_TAG.test(tag);
  const monthCondition = isYear ? ' OR (name >= ? AND name < ?)' : '';
  const monthBounds = isYear ? [`${tag}-`, `${tag}.`] : [];
  return {
    sql: `SELECT file_id FROM file_tag WHERE tag_id IN
      (SELECT id FROM tag WHERE name = ? OR (name >= ? AND name < ?)${monthCondition})`,
    params: [tag, ...childBounds(tag), ...monthBounds],
  };
}

/** The files carrying `any` or `all` of some tags, or null when there are none. */
function tagGroup(tags: Tag[], match: FileQuery['tag_match']): Clause | null {
  if (tags.length === 0) return null;
  const perTag = tags.map(filesWithTagOrChild);
  const joiner = match === 'any' ? ' OR ' : ' AND ';
  const sql = perTag.map((clause) => `f.id IN (${clause.sql})`).join(joiner);
  return { sql: `(${sql})`, params: perTag.flatMap((clause) => clause.params) };
}

/** The tag conditions of a query: its own tags, its extra groups, then its exclusions. */
export function tagClauses(query: FileQuery): Clause[] {
  const groups = [
    tagGroup(query.tags ?? [], query.tag_match),
    ...(query.tag_groups ?? []).map((group) => tagGroup(group.tags, group.tag_match)),
  ].filter((clause) => clause !== null);
  const exclusions = (query.exclude_tags ?? []).map((tag) => {
    const carriers = filesWithTagOrChild(tag);
    return { sql: `f.id NOT IN (${carriers.sql})`, params: carriers.params };
  });
  return [...groups, ...exclusions];
}
