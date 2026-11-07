/**
 * Compiles a `FileQuery` to SQL, and reads the rows it returns. Each filter becomes a `Clause`, and
 * the clauses join with AND in the order of their placeholders. A text search also adds the CTE
 * `hit` of content matches, left-joined so a file whose path alone matches still appears.
 */
import { basename, sep } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import type { FileQuery, FileRow, Tag } from '../../types.ts';
import { fileName, folderRange } from './paths.ts';
import { type Clause, tagClauses } from './tag-filter.ts';

/** FTS5's trigram tokenizer finds nothing in a shorter query, without an error. */
const MIN_MATCH_CHARS = 3;
/** A GLOB for a path with a segment that starts with a dot. */
const DOT_SEGMENT = `*${sep}.*`;
const FILE_NAME = fileName('f.path');

/** The file's tag names, sorted, as a JSON array. */
const SORTED_TAGS_JSON = `(SELECT json_group_array(name) FROM (SELECT t.name FROM file_tag ft
    JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = f.id ORDER BY t.name))`;
const MTIME_MS = 'CAST(f.mtime_ns AS INTEGER) / 1000000';

/** The columns of a `FileRow`, for a query that aliases `file` as `f`. */
export const FILE_COLUMNS = `f.id, f.path, f.size, ${MTIME_MS} AS mtime_ms, f.mime, f.status,
  ${SORTED_TAGS_JSON} AS tags`;

/** A row selected with `FILE_COLUMNS`. */
export type RawFileRow = Omit<FileRow, 'tags' | 'name'> & { tags: string };

/** Finishes a row from `FILE_COLUMNS`. */
export const toFileRow = (row: RawFileRow): FileRow => ({
  ...row,
  name: basename(row.path),
  tags: JSON.parse(row.tags) as Tag[],
});

/** A LIKE pattern for `text` anywhere, with LIKE's own wildcards escaped. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/** The CTE `hit`: the ids of files whose content holds the text, with a rank to sort by. */
function contentHits(text: string): Clause {
  // Counted in code points, as the trigram tokenizer counts characters.
  const tooShortForIndex = Array.from(text).length < MIN_MATCH_CHARS;
  if (tooShortForIndex) {
    return {
      sql: `WITH hit AS MATERIALIZED
         (SELECT rowid AS id, 0 AS rank FROM content WHERE text LIKE ? ESCAPE '\\')`,
      params: [likePattern(text)],
    };
  }
  // Left to itself, SQLite runs the MATCH again for every file row: O(n²) when many files hit.
  const quotedPhrase = `"${text.replaceAll('"', '""')}"`;
  return {
    sql: `WITH hit AS MATERIALIZED (SELECT rowid AS id, rank FROM content WHERE content MATCH ?)`,
    params: [quotedPhrase],
  };
}

/** The library `l` that holds the file, by its path plus a separator. */
const IN_LIBRARY = 'substr(f.path, 1, length(l.path) + 1) = l.path || ?';
/** The file's path below the library `l`. */
const PATH_BELOW_LIBRARY = 'substr(f.path, length(l.path) + 1)';

/** A library may itself sit in a dot folder, so only the part below the library counts. */
const NOT_A_DOTFILE: Clause = {
  sql: `(f.path NOT GLOB ? OR EXISTS (SELECT 1 FROM library l
      WHERE ${IN_LIBRARY} AND ${PATH_BELOW_LIBRARY} NOT GLOB ?))`,
  params: [DOT_SEGMENT, sep, DOT_SEGMENT],
};

/** Files whose content or path holds the text. */
const textClause = (text: string): Clause => ({
  sql: `(hit.id IS NOT NULL OR f.path LIKE ? ESCAPE '\\')`,
  params: [likePattern(text)],
});

/** Files anywhere under the folder. */
const folderClause = (folder: string): Clause => ({
  sql: 'f.path >= ? AND f.path < ?',
  params: folderRange(folder),
});

/** Files directly in the folder: no separator is left in the path below it. */
const directlyInClause = (folder: string): Clause => ({
  sql: 'instr(substr(f.path, length(?) + 1), ?) = 0',
  params: [folderRange(folder)[0], sep],
});

/** Every condition of a query, in the order of their placeholders. */
function whereClauses(query: FileQuery, text: string | undefined): Clause[] {
  const { folder, mime, status } = query;
  const clauses = [
    text ? textClause(text) : null,
    folder ? folderClause(folder) : null,
    ...tagClauses(query),
    mime ? { sql: 'f.mime GLOB ?', params: [mime] } : null,
    status ? { sql: 'f.status = ?', params: [status] } : null,
    folder && query.direct_only ? directlyInClause(folder) : null,
    query.hide_dotfiles ? NOT_A_DOTFILE : null,
  ];
  return clauses.filter((clause) => clause !== null);
}

/** A `FileQuery` as SQL parts that a page, a count or a column pick can each finish. */
export interface CompiledQuery {
  /** The `WITH hit ...` of content matches, or empty without a text search. */
  contentCte: string;
  /** `FROM ... WHERE ...` over `file f`. */
  fromWhere: string;
  /** The values of the placeholders in `contentCte` and then `fromWhere`. */
  params: SQLInputValue[];
  /** True with a text search, when `hit.rank` is there to sort on. */
  ranked: boolean;
}

/** Turns a query into the parts shared by the page and its total. */
export function compileQuery(query: FileQuery): CompiledQuery {
  const text = query.text?.trim() || undefined;
  const hits = text ? contentHits(text) : NO_CONTENT_CTE;
  const clauses = whereClauses(query, text);
  const conditions = ['1', ...clauses.map((clause) => clause.sql)].join(' AND ');
  const hitJoin = text ? 'LEFT JOIN hit ON hit.id = f.id' : '';
  return {
    contentCte: hits.sql,
    fromWhere: `FROM file f ${hitJoin} WHERE ${conditions}`,
    params: [...hits.params, ...clauses.flatMap((clause) => clause.params)],
    ranked: Boolean(text),
  };
}

/** No CTE: a query without a text search. */
const NO_CONTENT_CTE: Clause = { sql: '', params: [] };

/** What each sort orders by. `relevance` is apart, since it needs a text search to rank. */
const SORT_COLUMNS = {
  name: `${FILE_NAME} COLLATE NOCASE`,
  kind: `coalesce(f.mime, '')`,
  modified: 'CAST(f.mtime_ns AS INTEGER)',
  size: 'f.size',
};

/** bm25 is negative and lower is better, so best first needs no direction. Path-only hits follow. */
const BEST_MATCH_FIRST = 'coalesce(hit.rank, 0), f.id';
/** What `relevance` falls back to with no text search to rank by. */
const BY_NAME = `${FILE_NAME}, f.id`;

/** The ORDER BY of a query. */
export function orderBy(query: FileQuery, ranked: boolean): string {
  const sort = query.sort ?? (ranked ? 'relevance' : 'name');
  if (sort === 'relevance') return ranked ? BEST_MATCH_FIRST : BY_NAME;
  const isTextSort = sort === 'name' || sort === 'kind';
  const defaultOrder = isTextSort ? 'asc' : 'desc';
  const direction = (query.order ?? defaultOrder).toUpperCase();
  // `f.id` follows the direction, so a descending name sort can walk the `file_name` index too.
  return `${SORT_COLUMNS[sort]} ${direction}, f.id ${direction}`;
}
