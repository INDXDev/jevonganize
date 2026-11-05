/** Keeps the index in step with the disk: walk, compare fingerprints, mirror tags. */
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import ignore from 'ignore';
import mime from 'mime';
import type { Tag } from '../types.ts';
import type { Config } from './config.ts';
import { ifExists, paths, UserError } from './config.ts';
import type { Db, FileRecord, Fingerprint, MirrorTag } from './db.ts';
import { overwriteDropsTags, readTags } from './tags.ts';

const BATCH = 256;

/**
 * Never read, indexed, tagged or sent, whatever `exclude` says: see docs/security.md. Patterns with
 * an inner `/` need the `**` prefix, or `ignore` anchors them to the root of the path.
 */
const SECRETS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.p12',
  '*.pfx',
  '.ssh/',
  'id_rsa*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.gnupg/',
  '.aws/',
  '*.keychain',
  '*.keychain-db',
  '**/Library/Keychains/',
  '*.kdbx',
  'wallet.dat',
  '**/Library/Application Support/Google/Chrome/',
  '**/Library/Application Support/Microsoft Edge/',
  '**/Library/Application Support/Firefox/',
  '**/.config/google-chrome/',
  '**/.config/microsoft-edge/',
  '**/.mozilla/firefox/',
  '**/AppData/Local/Google/Chrome/User Data/',
  '**/AppData/Local/Microsoft/Edge/User Data/',
  '**/AppData/Roaming/Mozilla/Firefox/',
  '.jevonganize-probe-*', // left by `supported()` if it dies mid-probe
];

/** A running total of what a scan did. */
export interface ScanResult {
  /** Regular files looked at. */
  files: number;
  added: number;
  changed: number;
  moved: number;
  removed: number;
  /** New `restore` review items. */
  restores: number;
  /** Excluded by rule. A folder counts once, since it is never opened. */
  skipped: number;
  warnings: string[];
  /** Files whose row changed. */
  ids: number[];
}

export type Excluded = (path: string, directory: boolean) => boolean;

const posix = (path: string, directory: boolean) =>
  path.split(sep).join('/') + (directory ? '/' : '');

/** Builds the exclusion test for a library. Secrets match the whole path, so a root can't hide them. */
export function exclusions(config: Config, root: string): Excluded {
  const secrets = ignore().add(SECRETS);
  const user = ignore().add(config.exclude);
  // With a home folder as a library, these would index the keys, and the index would chase itself.
  const own = [paths.configDir(), dirname(paths.database()), dirname(paths.thumbnails())];
  return (path, directory) => {
    if (own.some((dir) => path === dir || path.startsWith(dir + sep))) return true;
    const whole = posix(path.slice(parse(path).root.length), directory);
    const inRoot = relative(root, path);
    // A path the matcher cannot judge is not one to read.
    if (!ignore.isPathValid(whole)) return true;
    if (secrets.ignores(whole)) return true;
    return inRoot !== '' && user.ignores(posix(inRoot, directory));
  };
}

/** True when a library's real path is itself a secret, whatever link led there. */
export function secretRoot(config: Config, real: string): boolean {
  return real !== parse(real).root && exclusions(config, real)(real, true);
}

/** Yields regular files, one directory at a time. Links and special files are never opened. */
async function* walk(
  dir: string,
  excluded: Excluded,
  result: ScanResult,
  unreadable: string[],
): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    unreadable.push(dir);
    result.warnings.push(`Could not read ${dir}: ${(error as NodeJS.ErrnoException).code}`);
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    // shortcut: a real U+FFFD in a name is skipped too, read names as buffers if that ever matters.
    if (entry.name.includes('�')) {
      result.warnings.push(`Skipped a name that is not valid UTF-8 in ${dir}`);
    } else if (entry.isDirectory()) {
      if (excluded(path, true)) result.skipped++;
      else yield* walk(path, excluded, result, unreadable);
    } else if (entry.isFile()) {
      if (excluded(path, false)) result.skipped++;
      else yield path;
    }
  }
}

const fingerprint = (path: string, info: BigIntStats): Fingerprint => ({
  path,
  dev: String(info.dev),
  ino: String(info.ino),
  size: Number(info.size),
  mtime_ns: String(info.mtimeNs),
  ctime_ns: String(info.ctimeNs),
});

const unchanged = (row: FileRecord, now: Fingerprint) =>
  row.path === now.path &&
  row.ino === now.ino &&
  row.size === now.size &&
  row.mtime_ns === now.mtime_ns &&
  row.ctime_ns === now.ctime_ns;

/** The row this path continues: its own, or that of a file that left its old path. */
async function priorRow(db: Db, now: Fingerprint): Promise<FileRecord | undefined> {
  const own = db.fileByPath(now.path);
  if (own) return own;
  for (const row of db.filesByInode(now.dev, now.ino)) {
    if (!(await ifExists(lstat(row.path)))) return row; // still there means a hard link
  }
  return undefined;
}

interface Observation {
  now: Fingerprint;
  row: FileRecord | undefined;
  tags: Tag[];
}

/** Reads what the disk says about a path, or `null` when there is nothing to do. */
async function observe(
  db: Db,
  path: string,
  result: ScanResult,
  seen: Set<number>,
): Promise<Observation | null> {
  try {
    const info = await ifExists(lstat(path, { bigint: true }));
    if (!info?.isFile()) return null; // it can turn into a link after the walk saw it
    result.files++;
    const now = fingerprint(path, info);
    const row = await priorRow(db, now);
    if (row) seen.add(row.id);
    if (row && unchanged(row, now)) return null;
    return { now, row, tags: await readTags(path) };
  } catch (error) {
    // The old fingerprint stays, so the next scan tries again. A failed lstat never reached `seen`.
    const own = db.fileByPath(path);
    if (own) seen.add(own.id);
    result.warnings.push(`Could not read ${path}: ${(error as Error).message}`);
    return null;
  }
}

/** Handles tags gone from a file, as in docs/tags.md#lost-tags. Returns the new `restore` items. */
export function recordRemoved(db: Db, id: number, removed: MirrorTag[], replaced: boolean): number {
  let restores = 0;
  for (const { tag, ai } of removed) {
    if (replaced) {
      const item = { file_id: id, kind: 'restore', tag, confidence: null } as const;
      if (db.addReview({ ...item, reason: 'Missing after the file was replaced' })) restores++;
    } else if (ai) db.rejectTag(id, tag, 'Removed by a person');
  }
  return restores;
}

/** Writes one observation to the index. Synchronous, so that a batch is one transaction. */
function record(db: Db, { now, row, tags }: Observation, result: ScanResult, seen: Set<number>) {
  const replaced = row !== undefined && row.ino !== now.ino;
  const edited =
    replaced || (row !== undefined && (row.size !== now.size || row.mtime_ns !== now.mtime_ns));
  const moved = row !== undefined && row.path !== now.path;
  if (moved) db.moveFile(row.id, now.path);
  const id = db.upsertFile(now, { edited, mime: mime.getType(now.path) });
  seen.add(id);

  const { added, removed } = db.syncFileTags(id, tags);
  result.restores += recordRemoved(db, id, removed, replaced || (edited && overwriteDropsTags));
  db.dropRestored(id, tags);

  if (!row) result.added++;
  else if (moved) result.moved++;
  else if (edited || added.length || removed.length) result.changed++;
  result.ids.push(id);
}

/** Handles one batch: async reads first, since a transaction must not span an `await`. */
async function scanBatch(db: Db, batch: string[], result: ScanResult, seen: Set<number>) {
  const observed = await Promise.all(batch.map((path) => observe(db, path, result, seen)));
  db.transaction(() => {
    for (const observation of observed) {
      if (observation) record(db, observation, result, seen);
    }
  });
  await yieldToLoop(); // tag reads and SQLite are synchronous, so nothing else ran until now
}

const emptyResult = (): ScanResult => ({
  files: 0,
  added: 0,
  changed: 0,
  moved: 0,
  removed: 0,
  restores: 0,
  skipped: 0,
  warnings: [],
  ids: [],
});

/**
 * Brings the index up to date with one library, and repairs any drift: the disk always wins. Never
 * writes to a file. Similarity numbers are left to the caller, once for all its libraries.
 */
// shortcut: renaming a file and creating a new one at its old path raises false `restore` items,
// which cost a click. Match inodes in a second pass if that proves common.
export async function scanLibrary(
  db: Db,
  config: Config,
  root: string,
  onProgress?: (progress: { done: number; current: string }) => void,
): Promise<ScanResult> {
  const base = resolve(root);
  // Going on would read an unplugged drive as every file deleted, losing provenance and history.
  if (!(await ifExists(stat(base)))?.isDirectory()) {
    throw new UserError(`${base} is not a folder that can be read`);
  }
  // A stored root can be, or become, a link to a secret folder.
  const excluded = secretRoot(config, await realpath(base)) ? () => true : exclusions(config, base);
  const result = emptyResult();
  const seen = new Set<number>();
  const unreadable: string[] = [];

  let batch: string[] = [];
  const flush = async () => {
    await scanBatch(db, batch, result, seen);
    const current = batch.at(-1);
    if (current !== undefined) onProgress?.({ done: result.files, current });
    batch = [];
  };
  for await (const path of walk(base, excluded, result, unreadable)) {
    batch.push(path);
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  const indexed = db.filesUnder(base);
  // An empty mount point looks like every file deleted, and the rows hold provenance and history.
  // shortcut: a folder a person really emptied keeps its rows too, until `remove_library`.
  if (result.files === 0 && indexed.length > 0) {
    result.warnings.push(
      `${base} has no files, but ${indexed.length} are indexed. Keeping them, in case a drive is unplugged`,
    );
    return result;
  }
  db.transaction(() => {
    for (const { id, path } of indexed) {
      // What could not be listed may still exist, and its row holds history.
      if (seen.has(id) || unreadable.some((dir) => path.startsWith(dir + sep))) continue;
      db.deleteFile(id);
      result.removed++;
      result.ids.push(id);
    }
  });
  db.markScanned(base);
  return result;
}

/**
 * Stats and compares only these paths, for `watch`. `needsWalk` is true when one was a directory or
 * a vanished indexed path: that can be a move, and only a full scan can tell a move from a delete.
 */
export async function scanPaths(
  db: Db,
  config: Config,
  root: string,
  candidates: string[],
): Promise<{ ids: number[]; needsWalk: boolean; warnings: string[] }> {
  const base = resolve(root);
  const excluded = exclusions(config, base);
  const result = emptyResult();
  const gone: string[] = [];
  const files: string[] = [];
  let needsWalk = false;
  for (const path of candidates) {
    const info = await ifExists(lstat(path));
    if (excluded(path, info?.isDirectory() ?? false)) continue;
    if (!info) gone.push(path);
    else if (info.isDirectory()) needsWalk = true;
    else if (info.isFile()) files.push(path);
  }
  for (let start = 0; start < files.length; start += BATCH) {
    await scanBatch(db, files.slice(start, start + BATCH), result, new Set());
  }
  // After the files, so a rename seen whole in this batch has already moved its row.
  needsWalk ||= gone.some((path) => db.fileByPath(path) || db.filesUnder(path).length > 0);
  return { ids: result.ids, needsWalk, warnings: result.warnings };
}

/**
 * Stores a file's fingerprint straight after the app wrote its tags, so the scan and the watcher
 * do not take the moved ctime for an outside change.
 */
export async function recordWrite(db: Db, path: string): Promise<void> {
  db.upsertFile(fingerprint(path, await lstat(path, { bigint: true })), { edited: false });
}
