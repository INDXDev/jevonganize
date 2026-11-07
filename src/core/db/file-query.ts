/**
 * Compiles a `FileQuery` to SQL, and reads the rows it returns. Each filter becomes a `Clause`, and
 * the clauses join with AND in the order of their placeholders. A text search also adds the CTE `c`
 * of content matches, left-joined so a file whose path alone matches still appears.
 */
import { basename, sep } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import type { FileQuery, FileRow, Tag } from '../../types.ts';
import { fileName, folderRange } from './paths.ts';

/** FTS5's trigram tokenizer finds nothing in a shorter query, without an error. */
const MIN_MATCH_CHARS = 3;
const DOT_SEGMENT = `*${sep}.*`;
const FILE_NAME = fileName('f.path');
const YEAR_TAG = /^[^:]*:\d{4}$/;

/** The columns of a `FileRow`, for a query that aliases `file` as `f`. */
export const FILE_COLUMNS = `f.id, f.path, f.size, CAST(f.mtime_ns AS INTEGER) / 1000000 AS mtime_ms,
  f.mime, f.status,
  (SELECT json_group_array(name) FROM (SELECT t.name FROM file_tag ft
    JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = f.id ORDER BY t.name)) AS tags`;

/** A row selected with `FILE_COLUMNS`. */
export type RawFileRow = Omit<FileRow, 'tags' | 'name'> & { tags: string };

/** Finishes a row from `FILE_COLUMNS`. */
export const toFileRow = (row: RawFileRow): FileRow => ({
  ...row,
  name: basename(row.path),
  tags: JSON.parse(row.tags) as Tag[],
});

/** One condition and the values of its placeholders. */
type Clause = { sql: string; params: SQLInputValue[] };

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * A subquery of the files carrying a tag or its children. A range stays on the unique index: `0`
 * is the character after `/` and `.` the one after `-`, so each range is exactly that prefix.
 */
function filesWithTagOrChild(tag: Tag): Clause {
  if (tag.endsWith(':')) {
    // `topic:` is a whole namespace, and `;` is the character after `:`.
    return {
      sql: `SELECT file_id FROM file_tag WHERE tag_id IN
        (SELECT id FROM tag WHERE name >= ? AND name < ?)`,
      params: [tag, `${tag.slice(0, -1)};`],
    };
  }
  const isYear = YEAR_TAG.test(tag); // `doc-date:2026` also owns `doc-date:2026-03`
  const monthRange = isYear ? ' OR (name >= ? AND name < ?)' : '';
  const monthBounds = isYear ? [`${tag}-`, `${tag}.`] : [];
  return {
    sql: `SELECT file_id FROM file_tag WHERE tag_id IN
      (SELECT id FROM tag WHERE name = ? OR (name >= ? AND name < ?)${monthRange})`,
    params: [tag, `${tag}/`, `${tag}0`, ...monthBounds],
  };
}

/** The content matches as a CTE, with its parameter. */
function contentMatches(text: string): Clause {
  const tooShortForIndex = Array.from(text).length < MIN_MATCH_CHARS;
  if (tooShortForIndex) {
    return {
      sql: `WITH c AS MATERIALIZED
         (SELECT rowid AS id, 0 AS rank FROM content WHERE text LIKE ? ESCAPE '\\')`,
      params: [likePattern(text)],
    };
  }
  // Left to itself, SQLite runs the MATCH again for every file row: O(n²) when many files hit.
  return {
    sql: `WITH c AS MATERIALIZED (SELECT rowid AS id, rank FROM content WHERE content MATCH ?)`,
    params: [`"${text.replaceAll('"', '""')}"`],
  };
}

/** The files carrying `any` or `all` of some tags, or null when there are none. */
function tagGroup(tags: Tag[], match: FileQuery['tag_match']): Clause | null {
  const wanted = tags.map(filesWithTagOrChild);
  if (wanted.length === 0) return null;
  const joiner = match === 'any' ? ' OR ' : ' AND ';
  const sql = wanted.map((clause) => `f.id IN (${clause.sql})`).join(joiner);
  return { sql: `(${sql})`, params: wanted.flatMap((clause) => clause.params) };
}

function tagClauses(query: FileQuery): Clause[] {
  const excluded = (query.exclude_tags ?? [])
    .map(filesWithTagOrChild)
    .map((match) => ({ sql: `f.id NOT IN (${match.sql})`, params: match.params }));
  const groups = [
    tagGroup(query.tags ?? [], query.tag_match),
    ...(query.tag_groups ?? []).map((group) => tagGroup(group.tags, group.tag_match)),
  ].filter((clause) => clause !== null);
  return [...groups, ...excluded];
}

/** A library may itself sit in a dot folder, so only the part below the library counts. */
const NOT_A_DOTFILE: Clause = {
  sql: `(f.path NOT GLOB ? OR EXISTS (SELECT 1 FROM library l
      WHERE substr(f.path, 1, length(l.path) + 1) = l.path || ?
        AND substr(f.path, length(l.path) + 1) NOT GLOB ?))`,
  params: [DOT_SEGMENT, sep, DOT_SEGMENT],
};

/** Every condition of a query, in the order of their placeholders. */
function whereClauses(query: FileQuery, text: string | undefined): Clause[] {
  const { folder, mime, status } = query;
  const clauses: Clause[] = [];
  if (text) {
    const sql = `(c.id IS NOT NULL OR f.path LIKE ? ESCAPE '\\')`;
    clauses.push({ sql, params: [likePattern(text)] });
  }
  if (folder) clauses.push({ sql: 'f.path >= ? AND f.path < ?', params: folderRange(folder) });
  clauses.push(...tagClauses(query));
  if (mime) clauses.push({ sql: 'f.mime GLOB ?', params: [mime] });
  if (status) clauses.push({ sql: 'f.status = ?', params: [status] });
  if (folder && query.direct_only) {
    const sql = 'instr(substr(f.path, length(?) + 1), ?) = 0';
    clauses.push({ sql, params: [folderRange(folder)[0], sep] });
  }
  if (query.hide_dotfiles) clauses.push(NOT_A_DOTFILE);
  return clauses;
}

/** Turns a query into the parts shared by the page and its total. */
export function compileQuery(query: FileQuery) {
  const text = query.text?.trim() || undefined;
  const matches = text ? contentMatches(text) : { sql: '', params: [] };
  const clauses = whereClauses(query, text);
  const where = ['1', ...clauses.map((clause) => clause.sql)].join(' AND ');
  return {
    matches: matches.sql,
    from: `FROM file f ${text ? 'LEFT JOIN c ON c.id = f.id' : ''} WHERE ${where}`,
    params: [...matches.params, ...clauses.flatMap((clause) => clause.params)],
    ranked: Boolean(text),
  };
}

const SORT_COLUMNS = {
  name: `${FILE_NAME} COLLATE NOCASE`,
  kind: `coalesce(f.mime, '')`,
  modified: 'CAST(f.mtime_ns AS INTEGER)',
  size: 'f.size',
};

/** The ORDER BY of a query. */
export function orderBy(query: FileQuery, ranked: boolean): string {
  const sort = query.sort ?? (ranked ? 'relevance' : 'name');
  // bm25 is negative and lower is better, so best first needs no direction. Name-only hits follow.
  if (sort === 'relevance') return ranked ? 'coalesce(c.rank, 0), f.id' : `${FILE_NAME}, f.id`;
  const defaultOrder = sort === 'name' || sort === 'kind' ? 'asc' : 'desc';
  const direction = (query.order ?? defaultOrder).toUpperCase();
  // `f.id` follows the direction, so a descending name sort can walk the `file_name` index too.
  return `${SORT_COLUMNS[sort]} ${direction}, f.id ${direction}`;
}
