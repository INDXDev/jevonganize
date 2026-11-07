/**
 * Keeps the index in step with the disk. The disk always wins, and a scan writes only to the index.
 *
 * A row is a file the index knows. A fingerprint is what `lstat` says about a path, so a file whose
 * fingerprint matches its row needs no further read. A scan walks a library and takes its paths in
 * batches, because a transaction must not span an `await`. Each batch has three steps:
 *
 * 1. `prefetch` runs `lstat` on every path and starts reading the tags of those that look changed.
 * 2. `detectChanges` compares each path with its row, and marks the row as seen.
 * 3. `recordChanges` writes every difference to the index in one transaction.
 *
 * Once the walk ends, `dropMissingRows` deletes the rows that were not seen. The file reads from top
 * to bottom: the entry points first, then the walk, the three steps, and the helpers they share.
 */
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import type { BigIntStats, Dirent } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import mime from 'mime';
import type { Tag } from '../types.ts';
import type { Config } from './config.ts';
import { ifExists, UserError } from './config.ts';
import type { Db, FileRecord, Fingerprint, MirrorTag } from './db.ts';
import { type Excluded, exclusions, secretRoot } from './exclusions.ts';
import { contentLooksSame, fingerprint, sameFingerprint } from './fingerprint.ts';
import { overwriteDropsTags } from './tags.ts';
import { readScanTags, type TagRead } from './tag-reader.ts';

const BATCH_SIZE = 256;

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

/** Reports how far a scan has got. */
type OnProgress = (progress: { done: number; current: string }) => void;

/** One scan: the index it updates and what it has learned so far. */
interface ScanPass {
  db: Db;
  result: ScanResult;
  /** Ids of the rows whose file was found. */
  seen: Set<number>;
  /** Folders that could not be listed. */
  unreadable: string[];
  /** Batches that wrote to the index, which tells whether rows read earlier still hold. */
  writes: number;
}

/** A path and what `lstat` said: nothing for a file that is gone, or why it could not say. */
interface PathStats {
  path: string;
  stats: BigIntStats | undefined | Error;
}

/** A batch on its way in: its `lstat`s, the rows they were compared with, and tag reads under way. */
interface Prefetched {
  pathStats: PathStats[];
  rowsByPath: Map<string, FileRecord>;
  /** `ScanPass.writes` when the rows were read. */
  writes: number;
  tagReads: Promise<TagRead[]>;
}

/** A file that differs from the index. `prior` is unset for a file the index has not met. */
interface Change {
  onDisk: Fingerprint;
  prior: FileRecord | undefined;
}

/**
 * Brings the index up to date with one library, and repairs any drift. Never writes to a file.
 * Similarity numbers are left to the caller, once for all its libraries.
 */
// shortcut: renaming a file and creating a new one at its old path raises false `restore` items,
// which cost a click. Match inodes in a second pass if that proves common.
export async function scanLibrary(
  db: Db,
  config: Config,
  libraryPath: string,
  onProgress?: OnProgress,
): Promise<ScanResult> {
  const root = resolve(libraryPath);
  const rootStats = await ifExists(stat(root));
  // Going on would read an unplugged drive as every file deleted, losing provenance and history.
  if (!rootStats?.isDirectory()) throw new UserError(`${root} is not a folder that can be read`);

  // A stored root can be, or become, a link to a secret folder.
  const rootIsSecret = secretRoot(config, await realpath(root));
  const excluded = rootIsSecret ? () => true : exclusions(config, root);
  const pass = startPass(db);
  await walkAndIndex(root, excluded, pass, onProgress);
  const { result } = pass;

  const indexed = db.filesUnder(root);
  // An empty mount point looks like every file deleted, and the rows hold provenance and history.
  // shortcut: a folder a person really emptied keeps its rows too, until `remove_library`.
  const mayBeUnplugged = result.files === 0 && indexed.length > 0;
  if (mayBeUnplugged) {
    result.warnings.push(
      `${root} has no files, but ${indexed.length} are indexed. Keeping them, in case a drive is unplugged`,
    );
    return result;
  }
  dropMissingRows(indexed, pass);
  db.markScanned(root);
  return result;
}

/**
 * Stats and compares only these paths, for `watch`. `needsWalk` is true when one was a directory or
 * a vanished indexed path: that can be a move, and only a full scan can tell a move from a delete.
 */
export async function scanPaths(
  db: Db,
  config: Config,
  libraryPath: string,
  candidates: string[],
): Promise<{ ids: number[]; needsWalk: boolean; warnings: string[] }> {
  const excluded = exclusions(config, resolve(libraryPath));
  const pass = startPass(db);
  const { gone, files, hasDirectory } = await classifyCandidates(candidates, excluded);
  for await (const batch of batchesOf(files)) await scanBatch(await prefetch(batch, pass), pass);
  // After the files, so a rename seen whole in this batch has already moved its row.
  const isIndexed = (path: string) => db.fileByPath(path) || db.filesUnder(path).length > 0;
  const needsWalk = hasDirectory || gone.some(isIndexed);
  return { ids: pass.result.ids, needsWalk, warnings: pass.result.warnings };
}

/**
 * Stores a file's fingerprint straight after the app wrote its tags, so the scan and the watcher
 * do not take the moved ctime for an outside change.
 */
export async function recordWrite(db: Db, path: string): Promise<void> {
  const stats = await lstat(path, { bigint: true });
  db.upsertFile(fingerprint(path, stats), { edited: false });
}

/** Handles tags gone from a file, as in docs/tags.md#lost-tags. Returns the new `restore` items. */
export function recordRemoved(db: Db, id: number, removed: MirrorTag[], replaced: boolean): number {
  if (!replaced) {
    for (const { tag, ai } of removed) if (ai) db.rejectTag(id, tag, 'Removed by a person');
    return 0;
  }
  let restores = 0;
  for (const { tag } of removed) {
    const item = { file_id: id, kind: 'restore', tag, confidence: null } as const;
    if (db.addReview({ ...item, reason: 'Missing after the file was replaced' })) restores++;
  }
  return restores;
}

const startPass = (db: Db): ScanPass => ({
  db,
  result: {
    files: 0,
    added: 0,
    changed: 0,
    moved: 0,
    removed: 0,
    restores: 0,
    skipped: 0,
    warnings: [],
    ids: [],
  },
  seen: new Set(),
  unreadable: [],
  writes: 0,
});

/** Walks a library and indexes what it finds. Each batch's disk reads overlap the one before it. */
async function walkAndIndex(
  root: string,
  excluded: Excluded,
  pass: ScanPass,
  onProgress?: OnProgress,
) {
  const scanAndReport = async (prefetched: Prefetched) => {
    await scanBatch(prefetched, pass);
    onProgress?.({ done: pass.result.files, current: prefetched.pathStats.at(-1)!.path });
  };
  let waiting: Prefetched | undefined;
  for await (const batch of batchesOf(walk(root, excluded, pass))) {
    const next = await prefetch(batch, pass);
    if (waiting) await scanAndReport(waiting);
    waiting = next;
  }
  if (waiting) await scanAndReport(waiting);
}

/** Groups paths into batches, none of them empty. */
async function* batchesOf(paths: Iterable<string> | AsyncIterable<string>) {
  let batch: string[] = [];
  for await (const path of paths) {
    batch.push(path);
    if (batch.length === BATCH_SIZE) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

/** Yields regular files, one directory at a time. Links and special files are never opened. */
async function* walk(dir: string, excluded: Excluded, pass: ScanPass): AsyncGenerator<string> {
  for (const entry of await listFolder(dir, pass)) {
    // shortcut: a real U+FFFD in a name is skipped too, read names as buffers if that ever matters.
    if (entry.name.includes('�')) {
      pass.result.warnings.push(`Skipped a name that is not valid UTF-8 in ${dir}`);
      continue;
    }
    const isDirectory = entry.isDirectory();
    if (!isDirectory && !entry.isFile()) continue;
    const path = join(dir, entry.name);
    if (excluded(path, isDirectory)) pass.result.skipped++;
    else if (isDirectory) yield* walk(path, excluded, pass);
    else yield path;
  }
}

/** Lists a folder. One that cannot be read lists as empty, and is noted in the pass. */
async function listFolder(dir: string, pass: ScanPass): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    pass.unreadable.push(dir);
    pass.result.warnings.push(`Could not read ${dir}: ${(error as NodeJS.ErrnoException).code}`);
    return [];
  }
}

/**
 * Starts a batch's disk reads, so the tag worker runs during the previous batch's transaction. The
 * rows here may be one batch old, which is fine for guessing what to read: `detectChanges` decides
 * what a path is from the rows as they stand then, and `withMissedReads` reads whatever this missed.
 */
async function prefetch(batch: string[], pass: ScanPass): Promise<Prefetched> {
  const rowsByPath = rowsOf(pass.db, batch);
  const { writes } = pass;
  const pathStats = await Promise.all(batch.map(lstatPath));
  const looksChanged = ({ path, stats }: PathStats) => {
    if (!stats || stats instanceof Error || !stats.isFile()) return false;
    const row = rowsByPath.get(path);
    return !row || !sameFingerprint(row, fingerprint(path, stats));
  };
  const changedPaths = pathStats.filter(looksChanged).map(({ path }) => path);
  return { pathStats, rowsByPath, writes, tagReads: readScanTags(changedPaths) };
}

const rowsOf = (db: Db, paths: string[]) =>
  new Map(db.filesByPaths(paths).map((row) => [row.path, row]));

const lstatPath = async (path: string): Promise<PathStats> => ({
  path,
  stats: await ifExists(lstat(path, { bigint: true })).catch((error: Error) => error),
});

/** Takes one prefetched batch through to the index. */
async function scanBatch(prefetched: Prefetched, pass: ScanPass) {
  const changes = await detectChanges(prefetched, pass);
  const tagReads = await withMissedReads(await prefetched.tagReads, changes);
  if (changes.length) {
    pass.db.transaction(() => recordChanges(changes, tagReads, pass));
    pass.writes++;
  }
  await yieldToLoop(); // SQLite writes must not keep other server requests waiting across batches
}

/** Compares a batch with the rows as they stand now, which an earlier batch may have changed. */
async function detectChanges(prefetched: Prefetched, pass: ScanPass): Promise<Change[]> {
  const { pathStats } = prefetched;
  const rowsAreCurrent = prefetched.writes === pass.writes;
  const paths = pathStats.map(({ path }) => path);
  const rowsByPath = rowsAreCurrent ? prefetched.rowsByPath : rowsOf(pass.db, paths);
  const detected = await Promise.all(
    pathStats.map((entry) => detectChange(entry, rowsByPath.get(entry.path), pass)),
  );
  return detected.filter((change) => change !== null);
}

/** Counts a path and marks its row seen. Returns its change, or `null` if it has none. */
async function detectChange(
  { path, stats }: PathStats,
  rowAtPath: FileRecord | undefined,
  pass: ScanPass,
): Promise<Change | null> {
  const giveUp = (error: Error) => {
    // A failed lstat never reached `seen`.
    keepUnread(pass, pass.db.fileByPath(path) ?? rowAtPath, path, error.message);
    return null;
  };
  if (stats instanceof Error) return giveUp(stats);
  if (!stats?.isFile()) return null; // it can turn into a link after the walk saw it

  pass.result.files++;
  const onDisk = fingerprint(path, stats);
  const prior = await priorRow(pass.db, onDisk, rowAtPath).catch((error: Error) => error);
  if (prior instanceof Error) return giveUp(prior);
  if (prior) pass.seen.add(prior.id);
  const unchanged = prior && sameFingerprint(prior, onDisk);
  return unchanged ? null : { onDisk, prior };
}

/** The row this path continues: its own, or that of a file that left its old path. */
async function priorRow(db: Db, onDisk: Fingerprint, rowAtPath: FileRecord | undefined) {
  if (rowAtPath) return rowAtPath;
  for (const row of db.filesByInode(onDisk.dev, onDisk.ino)) {
    if (!(await ifExists(lstat(row.path)))) return row; // still there means a hard link
  }
  return undefined;
}

/** Indexes tag reads by path, adding any change that the prefetch did not guess. */
async function withMissedReads(prefetched: TagRead[], changes: Change[]) {
  const readsByPath = new Map(prefetched.map((read) => [read.path, read]));
  const changedPaths = changes.map(({ onDisk }) => onDisk.path);
  const missed = changedPaths.filter((path) => !readsByPath.has(path));
  for (const read of await readScanTags(missed)) readsByPath.set(read.path, read);
  return readsByPath;
}

/** Records each change with its tag read. Synchronous, so that a batch is one transaction. */
function recordChanges(changes: Change[], readsByPath: Map<string, TagRead>, pass: ScanPass) {
  for (const change of changes) {
    const read = readsByPath.get(change.onDisk.path)!;
    if ('error' in read) keepUnread(pass, pass.db.fileByPath(read.path), read.path, read.error);
    else recordChange(change, read.tags, pass);
  }
}

/** Writes one change to the index. */
function recordChange({ onDisk, prior }: Change, tags: Tag[], { db, result, seen }: ScanPass) {
  const replaced = prior !== undefined && prior.ino !== onDisk.ino;
  const edited = prior !== undefined && !contentLooksSame(prior, onDisk);
  const moved = prior !== undefined && prior.path !== onDisk.path;
  if (moved) db.moveFile(prior.id, onDisk.path);
  const id = db.upsertFile(onDisk, { edited, mime: mime.getType(onDisk.path) });
  seen.add(id);

  const { added, removed } = db.syncFileTags(id, tags);
  const tagsWentWithContent = replaced || (edited && overwriteDropsTags);
  result.restores += recordRemoved(db, id, removed, tagsWentWithContent);
  db.dropRestored(id, tags);

  const tagsChanged = added.length > 0 || removed.length > 0;
  if (!prior) result.added++;
  else if (moved) result.moved++;
  else if (edited || tagsChanged) result.changed++;
  result.ids.push(id);
}

/** Keeps a row whose file could not be read: its old fingerprint stays, so the next scan retries. */
function keepUnread(pass: ScanPass, row: FileRecord | undefined, path: string, reason: string) {
  if (row) pass.seen.add(row.id);
  pass.result.warnings.push(`Could not read ${path}: ${reason}`);
}

/** Deletes the rows of files the walk did not find. */
function dropMissingRows(indexed: { id: number; path: string }[], pass: ScanPass) {
  const { db, result, seen, unreadable } = pass;
  // What could not be listed may still exist, and its row holds history.
  const mayExist = (path: string) => unreadable.some((dir) => path.startsWith(dir + sep));
  db.transaction(() => {
    for (const { id, path } of indexed) {
      if (seen.has(id) || mayExist(path)) continue;
      db.deleteFile(id);
      result.removed++;
      result.ids.push(id);
    }
  });
}

/** Splits watch events by what is on disk now, leaving out what is excluded. */
async function classifyCandidates(candidates: string[], excluded: Excluded) {
  const gone: string[] = [];
  const files: string[] = [];
  let hasDirectory = false;
  for (const path of candidates) {
    const stats = await ifExists(lstat(path));
    if (excluded(path, stats?.isDirectory() ?? false)) continue;
    if (!stats) gone.push(path);
    else if (stats.isDirectory()) hasDirectory = true;
    else if (stats.isFile()) files.push(path);
  }
  return { gone, files, hasDirectory };
}
