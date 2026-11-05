/** The SQLite index, and every SQL statement in the project. Tags on disk stay the truth. */
import { mkdirSync } from 'node:fs';
import { basename, dirname, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, StatementSync } from 'node:sqlite';
import type {
  Answer,
  FileDetail,
  FileQuery,
  FileRow,
  Library,
  Plan,
  PlanStatus,
  ReviewItem,
  SimilarFile,
  Tag,
  TagCount,
  TagOp,
} from '../types.ts';
import { paths, UserError } from './config.ts';

/** The last path segment. rtrim strips the trailing run of characters that are not separators. */
const fileName = (path: string) =>
  `substr(${path}, length(rtrim(${path}, replace(${path}, '${sep}', ''))) + 1)`;

/** Applied in order. `PRAGMA user_version` counts how many have run. */
const MIGRATIONS = [
  `
CREATE TABLE library (path TEXT PRIMARY KEY, scanned_at INTEGER);

CREATE TABLE file (
  id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
  dev TEXT, ino TEXT, size INTEGER, mtime_ns TEXT, ctime_ns TEXT,
  hash TEXT, state_hash TEXT, mime TEXT, metadata TEXT,
  status TEXT NOT NULL DEFAULT 'new', tag_w REAL NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX file_hash ON file(hash);
CREATE INDEX file_inode ON file(dev, ino);

CREATE TABLE tag (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, facet TEXT,
  weight REAL NOT NULL DEFAULT 1, df INTEGER NOT NULL DEFAULT 0, idf REAL NOT NULL DEFAULT 0
);
CREATE TABLE file_tag (
  tag_id INTEGER NOT NULL, file_id INTEGER NOT NULL,
  ai INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tag_id, file_id)
) WITHOUT ROWID;
CREATE INDEX file_tag_file ON file_tag(file_id, tag_id);

CREATE TABLE answer (
  key TEXT PRIMARY KEY, facet TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE file_answer (file_id INTEGER NOT NULL, facet TEXT NOT NULL, key TEXT NOT NULL,
  PRIMARY KEY (file_id, facet));

CREATE TABLE review (
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, kind TEXT NOT NULL, tag TEXT NOT NULL,
  confidence REAL, reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  UNIQUE (file_id, kind, tag)
);
CREATE TABLE plan (id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE vocabulary (facet TEXT NOT NULL, value TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (facet, value));
CREATE VIRTUAL TABLE content USING fts5(text, tokenize='trigram');
`,
  `
CREATE INDEX file_name ON file(${fileName('path')} COLLATE NOCASE);
ALTER TABLE plan ADD COLUMN claimed_at INTEGER;
CREATE TABLE plan_op (plan_id TEXT NOT NULL, file_id INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (plan_id, file_id)) WITHOUT ROWID;
`,
];

const BUSY_TIMEOUT_MS = 5000;
const SQLITE_NOTADB = 26;
/** FTS5's trigram tokenizer finds nothing in a shorter query, without an error. */
const MIN_MATCH_CHARS = 3;

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

/** A tag in the mirror, and whether the app wrote it. */
export interface MirrorTag {
  tag: Tag;
  ai: boolean;
}

export type VocabularyState = 'proposed' | 'active' | 'retired';

/** The handle every flow shares. */
export type Db = ReturnType<typeof openDb>;

const FILE_COLUMNS = `f.id, f.path, f.size, CAST(f.mtime_ns AS INTEGER) / 1000000 AS mtime_ms,
  f.mime, f.status,
  (SELECT json_group_array(name) FROM (SELECT t.name FROM file_tag ft
    JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = f.id ORDER BY t.name)) AS tags`;
const FILE_NAME = fileName('f.path');
const REVIEW_COLUMNS = 'id, file_id, kind, tag, confidence, reason';

type RawFileRow = Omit<FileRow, 'tags' | 'name'> & { tags: string };

const toFileRow = (row: RawFileRow): FileRow => ({
  ...row,
  name: basename(row.path),
  tags: JSON.parse(row.tags) as Tag[],
});

/** The bounds of everything under a folder: `sep` and the character right after it. */
function folderRange(folder: string): [string, string] {
  const base = folder.endsWith(sep) ? folder.slice(0, -1) : folder;
  return [base + sep, base + String.fromCodePoint(sep.codePointAt(0)! + 1)];
}

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/** A subquery of the files carrying a tag or its children. A range stays on the unique index. */
function filesWithTagOrChild(tag: Tag): { sql: string; params: string[] } {
  const year = /^[^:]*:\d{4}$/.test(tag); // `doc-date:2026` also owns `doc-date:2026-03`
  const params = [tag, `${tag}/`, `${tag}0`, ...(year ? [`${tag}-`, `${tag}.`] : [])];
  const dated = year ? ' OR (name >= ? AND name < ?)' : '';
  return {
    sql: `SELECT file_id FROM file_tag WHERE tag_id IN
      (SELECT id FROM tag WHERE name = ? OR (name >= ? AND name < ?)${dated})`,
    params,
  };
}

/** Turns a query into the parts shared by the page and its total. */
function compileQuery(query: FileQuery) {
  const where = ['1'];
  const params: SQLInputValue[] = [];
  let matches = '';
  let join = '';
  const text = query.text?.trim();
  if (text) {
    const long = Array.from(text).length >= MIN_MATCH_CHARS;
    // Left to itself, SQLite runs the MATCH again for every file row: O(n²) when many files hit.
    matches = long
      ? `WITH c AS MATERIALIZED (SELECT rowid AS id, rank FROM content WHERE content MATCH ?)`
      : `WITH c AS MATERIALIZED
           (SELECT rowid AS id, 0 AS rank FROM content WHERE text LIKE ? ESCAPE '\\')`;
    join = 'LEFT JOIN c ON c.id = f.id';
    params.push(long ? `"${text.replaceAll('"', '""')}"` : likePattern(text));
    where.push(`(c.id IS NOT NULL OR f.path LIKE ? ESCAPE '\\')`);
    params.push(likePattern(text));
  }
  if (query.folder) {
    where.push('f.path >= ? AND f.path < ?');
    params.push(...folderRange(query.folder));
  }
  for (const tag of query.tags ?? []) {
    const match = filesWithTagOrChild(tag);
    where.push(`f.id IN (${match.sql})`);
    params.push(...match.params);
  }
  for (const tag of query.exclude_tags ?? []) {
    const match = filesWithTagOrChild(tag);
    where.push(`f.id NOT IN (${match.sql})`);
    params.push(...match.params);
  }
  if (query.mime) {
    where.push('f.mime GLOB ?');
    params.push(query.mime);
  }
  if (query.status) {
    where.push('f.status = ?');
    params.push(query.status);
  }
  return {
    matches,
    from: `FROM file f ${join} WHERE ${where.join(' AND ')}`,
    params,
    ranked: Boolean(text),
  };
}

function orderBy(query: FileQuery, ranked: boolean): string {
  const sort = query.sort ?? (ranked ? 'relevance' : 'name');
  // bm25 is negative and lower is better, so best first needs no direction. Name-only hits follow.
  if (sort === 'relevance') return ranked ? 'coalesce(c.rank, 0), f.id' : `${FILE_NAME}, f.id`;
  const direction = (query.order ?? (sort === 'name' ? 'asc' : 'desc')).toUpperCase();
  const column = {
    name: `${FILE_NAME} COLLATE NOCASE`,
    modified: 'CAST(f.mtime_ns AS INTEGER)',
    size: 'f.size',
  }[sort];
  // `f.id` follows the direction, so a descending name sort can walk the `file_name` index too.
  return `${column} ${direction}, f.id ${direction}`;
}

function parseAnswers(body: string): Answer[] | undefined {
  try {
    const answers: unknown = JSON.parse(body);
    return Array.isArray(answers) ? (answers as Answer[]) : undefined;
  } catch {
    return undefined; // a damaged row counts as a miss
  }
}

/** Opens or creates the index, migrating it. An index from a newer version is refused untouched. */
export function openDb(location: string = paths.database()) {
  if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true, mode: 0o700 });
  const raw = new DatabaseSync(location, { timeout: BUSY_TIMEOUT_MS });
  const statements = new Map<string, StatementSync>();

  function prepared(sql: string): StatementSync {
    let statement = statements.get(sql);
    if (!statement) statements.set(sql, (statement = raw.prepare(sql)));
    return statement;
  }
  const all = <T>(sql: string, ...params: SQLInputValue[]) =>
    prepared(sql).all(...params) as unknown as T[];
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- names the row type at each call site
  const get = <T>(sql: string, ...params: SQLInputValue[]) =>
    prepared(sql).get(...params) as unknown as T | undefined;
  const run = (sql: string, ...params: SQLInputValue[]) => prepared(sql).run(...params);

  /**
   * Runs `work` in one write transaction, joining any already open. It must be synchronous: on a
   * shared connection, an `await` here would pull other callers' writes into the transaction.
   */
  function transaction<T>(work: () => T): T {
    if (raw.isTransaction) return work();
    raw.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      raw.exec('COMMIT');
      return result;
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
  }

  const schemaVersion = () => get<{ user_version: number }>('PRAGMA user_version')!.user_version;

  function migrate(): void {
    const found = schemaVersion();
    if (found > MIGRATIONS.length) {
      throw new UserError(
        `${location} was written by a newer version of Jevonganize. Update it to use this index`,
      );
    }
    raw.exec('PRAGMA journal_mode = WAL');
    if (found === MIGRATIONS.length) return;
    transaction(() => {
      // Another process may have migrated while this one waited for the lock.
      for (const sql of MIGRATIONS.slice(schemaVersion())) raw.exec(sql);
      raw.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    });
  }

  try {
    migrate();
  } catch (error) {
    raw.close();
    if ((error as { errcode?: number }).errcode === SQLITE_NOTADB) {
      throw new UserError(`${location} is not a Jevonganize index`);
    }
    throw error;
  }

  function fileRow(id: number): FileRow | undefined {
    const row = get<RawFileRow>(`SELECT ${FILE_COLUMNS} FROM file f WHERE f.id = ?`, id);
    return row && toFileRow(row);
  }

  function fileTags(fileId: number): MirrorTag[] {
    return all<{ tag: Tag; ai: number }>(
      `SELECT t.name AS tag, ft.ai FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
       WHERE ft.file_id = ? ORDER BY t.name`,
      fileId,
    ).map(({ tag, ai }) => ({ tag, ai: ai === 1 }));
  }

  /** Keeps `tag_w` right for one file, using the current `idf`. */
  function updateWeight(fileId: number): void {
    run(
      `UPDATE file SET tag_w = coalesce((SELECT sum(t.idf * t.weight) FROM file_tag ft
         JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = file.id), 0) WHERE id = ?`,
      fileId,
    );
  }

  function addFileTags(fileId: number, tags: Tag[], ai: boolean): void {
    transaction(() => {
      for (const tag of tags) {
        const { id } = get<{ id: number }>(
          `INSERT INTO tag (name) VALUES (?)
           ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`,
          tag,
        )!;
        run(
          `INSERT INTO file_tag (tag_id, file_id, ai) VALUES (?, ?, ?)
           ON CONFLICT (tag_id, file_id) DO UPDATE SET ai = excluded.ai`,
          id,
          fileId,
          ai ? 1 : 0,
        );
      }
      updateWeight(fileId);
    });
  }

  function removeFileTags(fileId: number, tags: Tag[]): void {
    transaction(() => {
      for (const tag of tags) {
        run(
          `DELETE FROM file_tag WHERE file_id = ?
           AND tag_id = (SELECT id FROM tag WHERE name = ?)`,
          fileId,
          tag,
        );
      }
      updateWeight(fileId);
    });
  }

  function filesUnder(folder: string): { id: number; path: string }[] {
    return all(`SELECT id, path FROM file WHERE path >= ? AND path < ?`, ...folderRange(folder));
  }

  function deleteFile(id: number): void {
    transaction(() => {
      // Row ids get reused, so anything left behind would attach to a future file.
      run('DELETE FROM file_tag WHERE file_id = ?', id);
      run('DELETE FROM file_answer WHERE file_id = ?', id);
      run('DELETE FROM review WHERE file_id = ?', id);
      run('DELETE FROM content WHERE rowid = ?', id);
      run('DELETE FROM file WHERE id = ?', id);
    });
  }

  function fileAnswers(fileId: number): Answer[] {
    return all<{ body: string }>(
      `SELECT a.body FROM file_answer fa JOIN answer a ON a.key = fa.key
       WHERE fa.file_id = ? ORDER BY fa.facet`,
      fileId,
    ).flatMap(({ body }) => parseAnswers(body) ?? []);
  }

  function reviewsForFile(fileId: number): ReviewItem[] {
    return all(
      `SELECT ${REVIEW_COLUMNS} FROM review WHERE file_id = ? AND state = 'open' ORDER BY tag`,
      fileId,
    );
  }

  return {
    transaction,

    /** Closes the connection. */
    close: () => raw.close(),

    /** The schema version of this index. */
    schemaVersion,

    // Libraries

    /** Adds a folder. Adding it twice changes nothing. */
    addLibrary(path: string): void {
      run('INSERT OR IGNORE INTO library (path) VALUES (?)', path);
    },

    /** Forgets a folder and its index rows, except files inside another library. Tags stay. */
    removeLibrary(path: string): void {
      transaction(() => {
        run('DELETE FROM library WHERE path = ?', path);
        const others = all<{ path: string }>('SELECT path FROM library').map((row) => row.path);
        for (const file of filesUnder(path)) {
          if (!others.some((other) => file.path.startsWith(folderRange(other)[0]))) {
            deleteFile(file.id);
          }
        }
      });
    },

    /** All libraries with their file counts. `taggable` needs the disk, so tools add it. */
    listLibraries(): Omit<Library, 'taggable'>[] {
      return all<{ path: string; scanned_at: number | null }>(
        'SELECT path, scanned_at FROM library ORDER BY path',
      ).map((library) => ({
        ...library,
        files: get<{ n: number }>(
          'SELECT count(*) AS n FROM file WHERE path >= ? AND path < ?',
          ...folderRange(library.path),
        )!.n,
      }));
    },

    /** Stamps a library as scanned now. Does nothing for a folder that is not a library. */
    markScanned(path: string): void {
      run('UPDATE library SET scanned_at = ? WHERE path = ?', Date.now(), path);
    },

    // Files

    /**
     * Inserts a file or updates its fingerprint, and returns its id. `edited` means the content may
     * differ: status goes back to `new` and the hashes are cleared, as they no longer describe it.
     */
    upsertFile(file: Fingerprint, options: { edited: boolean; mime?: string | null }): number {
      const reset = options.edited
        ? `, status = 'new', hash = NULL, state_hash = NULL, error = NULL`
        : '';
      return get<{ id: number }>(
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
    },

    /** The stored row, with its fingerprint, for a path. */
    fileByPath: (path: string) => get<FileRecord>('SELECT * FROM file WHERE path = ?', path),

    /** The stored row for an id. */
    fileById: (id: number) => get<FileRecord>('SELECT * FROM file WHERE id = ?', id),

    /** Rows on an inode: more than one for hard links. Finds a file that moved. */
    filesByInode: (dev: string, ino: string) =>
      all<FileRecord>('SELECT * FROM file WHERE dev = ? AND ino = ?', dev, ino),

    /** Points a row at a new path. Tags, answers and history stay. */
    moveFile(id: number, path: string): void {
      run('UPDATE file SET path = ? WHERE id = ?', path, id);
    },

    /** Deletes a file's row and all that hangs off it. `answer` rows stay: they cost money. */
    deleteFile,

    /** Id and path of every file below a folder. */
    filesUnder,

    /** Records what organize found. A field left out keeps its stored value. */
    setFileResult(
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
      run(
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
    },

    /** One file as the UI sees it. */
    fileRow,

    /** Everything the inspector shows, but `taggable`, which needs the disk. */
    fileDetail(id: number): Omit<FileDetail, 'taggable'> | undefined {
      const row = fileRow(id);
      if (!row) return undefined;
      const { metadata } = get<{ metadata: string | null }>(
        'SELECT metadata FROM file WHERE id = ?',
        id,
      )!;
      return {
        ...row,
        metadata: metadata ? (JSON.parse(metadata) as FileDetail['metadata']) : {},
        answers: fileAnswers(id),
        reviews: reviewsForFile(id),
      };
    },

    /** Runs a `FileQuery`. Without `limit` it returns every match, so callers bound what they show. */
    searchFiles(query: FileQuery): { files: FileRow[]; total: number } {
      const { matches, from, params, ranked } = compileQuery(query);
      const { n } = get<{ n: number }>(`${matches} SELECT count(*) AS n ${from}`, ...params)!;
      const rows = all<RawFileRow>(
        `${matches} SELECT ${FILE_COLUMNS} ${from}
         ORDER BY ${orderBy(query, ranked)} LIMIT ? OFFSET ?`,
        ...params,
        query.limit ?? -1,
        query.offset ?? 0,
      );
      return { files: rows.map(toFileRow), total: n };
    },

    /** What `estimate` reads of a `FileQuery`, without the cost of every file's tags. */
    fileStates(query: FileQuery) {
      const { matches, from, params, ranked } = compileQuery(query);
      return all<Pick<FileRecord, 'id' | 'size' | 'mime' | 'state_hash'>>(
        `${matches} SELECT f.id, f.size, f.mime, f.state_hash ${from}
         ORDER BY ${orderBy(query, ranked)} LIMIT ? OFFSET ?`,
        ...params,
        query.limit ?? -1,
        query.offset ?? 0,
      );
    },

    /** Files most like this one, by IDF-weighted Jaccard. See docs/storage.md. */
    similarFiles(id: number, limit = 20): SimilarFile[] {
      const hits = all<{ file_id: number; score: number }>(
        `WITH q AS (SELECT ft.tag_id, t.idf * t.weight AS w FROM file_tag ft
                    JOIN tag t ON t.id = ft.tag_id
                    WHERE ft.file_id = ?1 AND t.weight > 0),
              total AS (SELECT sum(w) AS s FROM q),
              hits AS (SELECT ft.file_id, sum(q.w) AS shared FROM q
                       JOIN file_tag ft ON ft.tag_id = q.tag_id
                       WHERE ft.file_id <> ?1 GROUP BY ft.file_id)
         SELECT h.file_id, h.shared / (total.s + f.tag_w - h.shared) AS score
         FROM hits h JOIN file f ON f.id = h.file_id, total
         WHERE total.s + f.tag_w - h.shared > 0
         ORDER BY score DESC, h.file_id LIMIT ?2`,
        id,
        limit,
      );
      const mine = new Set(
        all<{ name: Tag }>(
          `SELECT t.name FROM file_tag ft JOIN tag t ON t.id = ft.tag_id
           WHERE ft.file_id = ? AND t.weight > 0`,
          id,
        ).map((row) => row.name),
      );
      return hits.map(({ file_id, score }) => {
        const row = fileRow(file_id)!;
        return { ...row, score, shared: row.tags.filter((tag) => mine.has(tag)) };
      });
    },

    /** Counts across the index, for `status`. */
    stats() {
      return get<{ files: number; organized: number; tags: number; reviews: number }>(
        `SELECT (SELECT count(*) FROM file) AS files,
           (SELECT count(*) FROM file WHERE status = 'organized') AS organized,
           (SELECT count(DISTINCT tag_id) FROM file_tag) AS tags,
           (SELECT count(*) FROM review WHERE state = 'open') AS reviews`,
      )!;
    },

    // Tags

    /** The mirror for one file, sorted. */
    fileTags,

    /** Adds tags to the mirror, setting `ai` on each. Keeps `tag_w` right. */
    addFileTags,

    /** Removes tags from the mirror. Keeps `tag_w` right. */
    removeFileTags,

    /**
     * Makes the mirror equal the disk. A tag that stays keeps its `ai` flag, and a new one is human.
     * Returns the difference, so a scan can tell what a person removed.
     */
    syncFileTags(fileId: number, tags: Tag[]): { added: Tag[]; removed: MirrorTag[] } {
      const current = fileTags(fileId);
      const known = new Set(current.map((row) => row.tag));
      const wanted = new Set(tags);
      const added = tags.filter((tag) => !known.has(tag));
      const removed = current.filter((row) => !wanted.has(row.tag));
      if (added.length || removed.length) {
        transaction(() => {
          removeFileTags(
            fileId,
            removed.map((row) => row.tag),
          );
          addFileTags(fileId, added, false);
        });
      }
      return { added, removed };
    },

    /** Ids of files carrying exactly this tag, children excluded. */
    filesWithTag(tag: Tag): number[] {
      return all<{ file_id: number }>(
        `SELECT file_id FROM file_tag WHERE tag_id = (SELECT id FROM tag WHERE name = ?)`,
        tag,
      ).map((row) => row.file_id);
    },

    /** Tags in use, most used first, optionally within a folder or a facet. */
    tagCounts(filter: { folder?: string; facet?: string } = {}): TagCount[] {
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
      return all(
        `SELECT t.name AS tag, t.facet, count(*) AS count FROM file_tag ft
         JOIN tag t ON t.id = ft.tag_id ${files}
         WHERE ${where.join(' AND ')} GROUP BY t.id ORDER BY count DESC, t.name`,
        ...params,
      );
    },

    /**
     * Stamps each tag with its facet and similarity weight. Only a caller holding the facets knows
     * which prefixes are facets, so run this after loading them and before `refreshIdf`.
     */
    setTagFacets(facets: { id: string; weight: number }[]): void {
      transaction(() => {
        for (const { id, weight } of facets) {
          // `;` is the character right after `:`.
          run(
            `UPDATE tag SET facet = ?, weight = ? WHERE (name >= ? AND name < ?) OR name = ?`,
            id,
            weight,
            `${id}:`,
            `${id};`,
            `flag:${id}`,
          );
        }
      });
    },

    /** Recomputes `df`, `idf` and every `tag_w`. Runs after each scan. */
    refreshIdf(): void {
      transaction(() => {
        const { n } = get<{ n: number }>('SELECT count(*) AS n FROM file')!;
        run('UPDATE tag SET df = (SELECT count(*) FROM file_tag WHERE tag_id = tag.id)');
        run('UPDATE tag SET idf = ln(1 + (? - df + 0.5) / (df + 0.5))', n);
        run(`UPDATE file SET tag_w = coalesce((SELECT sum(t.idf * t.weight) FROM file_tag ft
               JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = file.id), 0)`);
      });
    },

    // Answers

    /** Stores raw answers. Two processes racing on a key is fine: the first one stays. */
    putAnswer(key: string, facet: string, answers: Answer[]): void {
      run(
        'INSERT OR REPLACE INTO answer (key, facet, body, created_at) VALUES (?, ?, ?, ?)',
        key,
        facet,
        JSON.stringify(answers),
        Date.now(),
      );
    },

    /** The cached answers for a key. A missing or damaged row is `undefined`. */
    getAnswer(key: string): Answer[] | undefined {
      const row = get<{ body: string }>('SELECT body FROM answer WHERE key = ?', key);
      return row && parseAnswers(row.body);
    },

    /** The rows of many keys in one query, for a loop that would otherwise read them one by one. */
    getAnswers(keys: string[]): Map<string, Answer[]> {
      const rows = all<{ key: string; body: string }>(
        'SELECT key, body FROM answer WHERE key IN (SELECT value FROM json_each(?))',
        JSON.stringify(keys),
      );
      return new Map(
        rows.flatMap(({ key, body }) => {
          const answers = parseAnswers(body);
          return answers ? [[key, answers]] : [];
        }),
      );
    },

    /** Records which answer a file uses for a facet. */
    linkAnswer(fileId: number, facet: string, key: string): void {
      run(
        `INSERT INTO file_answer (file_id, facet, key) VALUES (?, ?, ?)
         ON CONFLICT (file_id, facet) DO UPDATE SET key = excluded.key`,
        fileId,
        facet,
        key,
      );
    },

    /** Every answer a file uses, across facets. */
    fileAnswers,

    // Reviews

    /** Adds an open item. An existing row, rejected ones included, stays. True if it was added. */
    addReview(item: Omit<ReviewItem, 'id'>): boolean {
      const { changes } = run(
        `INSERT OR IGNORE INTO review (file_id, kind, tag, confidence, reason)
         VALUES (?, ?, ?, ?, ?)`,
        item.file_id,
        item.kind,
        item.tag,
        item.confidence,
        item.reason,
      );
      return changes > 0;
    },

    /** Open items, by tag and then highest confidence, optionally for one tag. */
    listReviews(filter: { tag?: Tag; limit?: number } = {}): ReviewItem[] {
      const byTag = filter.tag === undefined ? '' : 'AND tag = ?';
      return all(
        `SELECT ${REVIEW_COLUMNS} FROM review WHERE state = 'open' ${byTag}
         ORDER BY tag, confidence DESC NULLS LAST, id LIMIT ?`,
        ...(filter.tag === undefined ? [] : [filter.tag]),
        filter.limit ?? -1,
      );
    },

    /** Open items for one file. */
    reviewsForFile,

    /** Items by id, whatever their state. */
    reviewsByIds(ids: number[]): ReviewItem[] {
      return ids.flatMap(
        (id) => get<ReviewItem>(`SELECT ${REVIEW_COLUMNS} FROM review WHERE id = ?`, id) ?? [],
      );
    },

    /** Closes items. A rejected `suggest` stays as a tombstone. A `restore` goes, so it can recur. */
    resolveReviews(ids: number[], state: 'accepted' | 'rejected'): void {
      transaction(() => {
        for (const id of ids) {
          run(`DELETE FROM review WHERE id = ? AND kind = 'restore'`, id);
          run('UPDATE review SET state = ? WHERE id = ?', state, id);
        }
      });
    },

    /** Stores a tombstone, so `resolve` never brings this tag back to this file. */
    rejectTag(fileId: number, tag: Tag, reason: string): void {
      run(
        `INSERT INTO review (file_id, kind, tag, reason, state) VALUES (?, 'suggest', ?, ?, 'rejected')
         ON CONFLICT (file_id, kind, tag) DO UPDATE SET state = 'rejected'`,
        fileId,
        tag,
        reason,
      );
    },

    /** Lifts a tombstone: a person put this tag back. */
    unrejectTag(fileId: number, tag: Tag): void {
      run(
        `DELETE FROM review WHERE file_id = ? AND tag = ? AND kind = 'suggest' AND state = 'rejected'`,
        fileId,
        tag,
      );
    },

    /** Tags that must not come back to this file. */
    rejectedTags(fileId: number): Tag[] {
      return all<{ tag: Tag }>(
        `SELECT tag FROM review WHERE file_id = ? AND state = 'rejected' ORDER BY tag`,
        fileId,
      ).map((row) => row.tag);
    },

    /** Drops `restore` items whose tag is back on the file. */
    dropRestored(fileId: number, tags: Tag[]): void {
      for (const tag of tags) {
        run(`DELETE FROM review WHERE file_id = ? AND kind = 'restore' AND tag = ?`, fileId, tag);
      }
    },

    // Plans

    /** Stores a plan, replacing any with its id. */
    savePlan(plan: Plan): void {
      run(
        `INSERT INTO plan (id, body, status, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET body = excluded.body, status = excluded.status`,
        plan.id,
        JSON.stringify(plan),
        plan.status,
        plan.created_at,
      );
    },

    /** A plan with its ops. */
    getPlan(id: string): Plan | undefined {
      const row = get<{ body: string }>('SELECT body FROM plan WHERE id = ?', id);
      return row && (JSON.parse(row.body) as Plan);
    },

    /** Plans, newest first, with `ops` empty, so a huge plan costs nothing to list. */
    listPlans(status?: PlanStatus): Plan[] {
      const filter = status === undefined ? '' : 'WHERE status = ?';
      return all<{ body: string }>(
        `SELECT json_remove(body, '$.ops') AS body FROM plan ${filter}
         ORDER BY created_at DESC, id`,
        ...(status === undefined ? [] : [status]),
      ).map((row) => ({ ...(JSON.parse(row.body) as Omit<Plan, 'ops'>), ops: [] }));
    },

    /** Deletes a plan. */
    deletePlan(id: string): void {
      run('DELETE FROM plan WHERE id = ?', id);
    },

    /** Moves a proposed plan to `applying`. One statement, so only one caller of any process wins. */
    claimPlan(id: string, now: number): boolean {
      const { changes } = run(
        `UPDATE plan SET status = 'applying', claimed_at = ?,
           body = json_set(body, '$.status', 'applying')
         WHERE id = ? AND status = 'proposed'`,
        now,
        id,
      );
      return changes > 0;
    },

    /** Shows that the run holding a claim is alive. */
    touchPlan(id: string, now: number): void {
      run('UPDATE plan SET claimed_at = ? WHERE id = ?', now, id);
    },

    /** Gives back claims with no sign of life since `before`. */
    releasePlans(before: number): void {
      run(
        `UPDATE plan SET status = 'proposed', body = json_set(body, '$.status', 'proposed')
         WHERE status = 'applying' AND claimed_at < ?`,
        before,
      );
    },

    /** Records one op a running apply has written, apart from the plan so the cost stays flat. */
    addPlanOp(planId: string, op: TagOp): void {
      run(
        'INSERT OR REPLACE INTO plan_op (plan_id, file_id, body) VALUES (?, ?, ?)',
        planId,
        op.file_id,
        JSON.stringify(op),
      );
    },

    /** The ops an unfinished apply has written. */
    planOps(planId: string): TagOp[] {
      return all<{ body: string }>('SELECT body FROM plan_op WHERE plan_id = ?', planId).map(
        (row) => JSON.parse(row.body) as TagOp,
      );
    },

    /** Forgets those ops, once the plan holds them. */
    clearPlanOps(planId: string): void {
      run('DELETE FROM plan_op WHERE plan_id = ?', planId);
    },

    // Vocabulary

    /** Sets a value's state, adding it if new. */
    setVocabulary(facet: string, value: string, state: VocabularyState): void {
      run(
        `INSERT INTO vocabulary (facet, value, state) VALUES (?, ?, ?)
         ON CONFLICT (facet, value) DO UPDATE SET state = excluded.state`,
        facet,
        value,
        state,
      );
    },

    /** Adds a suggested value. One already active or retired stays as it is. */
    proposeVocabulary(facet: string, value: string): void {
      run(
        `INSERT OR IGNORE INTO vocabulary (facet, value, state) VALUES (?, ?, 'proposed')`,
        facet,
        value,
      );
    },

    /** Open-facet values, optionally for one facet. */
    listVocabulary(facet?: string) {
      const filter = facet === undefined ? '' : 'WHERE facet = ?';
      return all<{ facet: string; value: string; state: VocabularyState }>(
        `SELECT facet, value, state FROM vocabulary ${filter} ORDER BY facet, value`,
        ...(facet === undefined ? [] : [facet]),
      );
    },

    // Content

    /** Replaces the searchable text of a file. */
    setContent(fileId: number, text: string): void {
      transaction(() => {
        run('DELETE FROM content WHERE rowid = ?', fileId);
        run('INSERT INTO content (rowid, text) VALUES (?, ?)', fileId, text);
      });
    },

    /** The searchable text of a file. */
    getContent(fileId: number): string | undefined {
      return get<{ text: string }>('SELECT text FROM content WHERE rowid = ?', fileId)?.text;
    },
  };
}
