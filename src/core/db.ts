/** The SQLite index. `db/` holds every SQL statement in the project. Tags on disk stay the truth. */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths, UserError } from './config.ts';
import * as answers from './db/answers.ts';
import { connect, type Sql } from './db/connection.ts';
import * as favorites from './db/favorites.ts';
import * as files from './db/files.ts';
import * as libraries from './db/libraries.ts';
import * as plans from './db/plans.ts';
import * as reports from './db/reports.ts';
import * as reviews from './db/reviews.ts';
import { migrate, schemaVersion } from './db/schema.ts';
import * as search from './db/search.ts';
import * as tagRefresh from './db/tag-refresh.ts';
import * as tagTree from './db/tag-tree.ts';
import * as tags from './db/tags.ts';
import * as usage from './db/usage.ts';
import * as vfolderSuggest from './db/vfolder-suggest.ts';
import * as vfolders from './db/vfolders.ts';
import * as vocabulary from './db/vocabulary.ts';

export type { FileRecord, Fingerprint } from './db/files.ts';
export type { UsageBucket } from './db/reports.ts';
export type { MirrorTag } from './db/tags.ts';
export type { UsageRecord } from './db/usage.ts';
export type { VirtualFolderRow } from './db/vfolders.ts';
export type { RuleTagRow } from './db/vfolder-suggest.ts';

const SQLITE_NOTADB = 26;
/** Usage rows older than this go when an index is opened. */
const USAGE_KEPT_MS = 365 * 24 * 60 * 60 * 1000;

/** A query function with its connection already given. */
type Bound<Queries> = {
  [Name in keyof Queries]: Queries[Name] extends (sql: Sql, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
};

/** Gives every query function of a module this connection, so callers never pass it. */
function bind<Queries extends object>(sql: Sql, queries: Queries): Bound<Queries> {
  const entries = Object.entries(queries) as [string, (sql: Sql, ...args: unknown[]) => unknown][];
  const bound = entries.map(([name, query]) => [name, (...args: unknown[]) => query(sql, ...args)]);
  return Object.fromEntries(bound) as Bound<Queries>;
}

/** The handle every flow shares. */
export type Db = ReturnType<typeof openDb>;

/** Opens or creates the index, migrating it. An index from a newer version is refused untouched. */
export function openDb(location: string = paths.database()) {
  if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true, mode: 0o700 });
  const sql = connect(location);
  try {
    migrate(sql, location);
  } catch (error) {
    sql.close();
    if ((error as { errcode?: number }).errcode === SQLITE_NOTADB) {
      throw new UserError(`${location} is not a Jevonganize index`);
    }
    throw error;
  }
  const db = {
    transaction: sql.transaction,
    /** Closes the connection. */
    close: sql.close,
    /** The schema version of this index. */
    schemaVersion: () => schemaVersion(sql),
    ...bind(sql, libraries),
    ...bind(sql, files),
    ...bind(sql, search),
    ...bind(sql, tags),
    ...bind(sql, answers),
    ...bind(sql, reviews),
    ...bind(sql, plans),
    ...bind(sql, vocabulary),
    ...bind(sql, tagRefresh),
    ...bind(sql, tagTree),
    ...bind(sql, vfolders),
    ...bind(sql, favorites),
    ...bind(sql, usage),
    ...bind(sql, reports),
    ...bind(sql, vfolderSuggest),
  };
  db.pruneUsage(Date.now() - USAGE_KEPT_MS);
  return db;
}
