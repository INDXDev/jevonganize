/**
 * Keeps the index in step with the disk: walk, compare fingerprints, mirror tags. The disk always
 * wins. A fingerprint is what `lstat` says about a path, so an unchanged one needs no further read.
 * A row is a file the index knows; `seen` collects rows the walk found, and the rest are gone.
 *
 * A scan reads tags and writes only to the index, in batches, as a transaction must not span an
 * `await`: each batch reads the disk first, then records every change at once.
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

/** What one scan has learned so far, shared by its walk and its batches. */
interface ScanPass {
  result: ScanResult;
  /** Ids of the rows whose file was found. */
  seen: Set<number>;
  /** Folders that could not be listed. */
  unreadable: string[];
  /** Batches that wrote to the index, which tells whether rows read earlier still hold. */
  writes: number;
}

/** Reports how far a scan has got. */
type OnProgress = (progress: { done: number; current: string }) => void;

const startPass = (): ScanPass => ({
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

const fingerprint = (path: string, info: BigIntStats): Fingerprint => ({
  path,
  dev: String(info.dev),
  ino: String(info.ino),
  size: Number(info.size),
  mtime_ns: String(info.mtimeNs),
  ctime_ns: String(info.ctimeNs),
});

/** Judged from the fingerprint alone: the content itself is never read here. */
const contentLooksSame = (row: FileRecord, onDisk: Fingerprint) =>
  row.ino === onDisk.ino && row.size === onDisk.size && row.mtime_ns === onDisk.mtime_ns;

const sameFingerprint = (row: FileRecord, onDisk: Fingerprint) =>
  row.path === onDisk.path && contentLooksSame(row, onDisk) && row.ctime_ns === onDisk.ctime_ns;

/** The row this path continues: its own, or that of a file that left its old path. */
async function priorRow(
  db: Db,
  onDisk: Fingerprint,
  rowAtPath: FileRecord | undefined,
): Promise<FileRecord | undefined> {
  if (rowAtPath) return rowAtPath;
  for (const row of db.filesByInode(onDisk.dev, onDisk.ino)) {
    if (!(await ifExists(lstat(row.path)))) return row; // still there means a hard link
  }
  return undefined;
}

/** A file that differs from the index. `prior` is unset for a file the index has not met. */
interface Change {
  onDisk: Fingerprint;
  prior: FileRecord | undefined;
}

/** Keeps a row whose file could not be read: its old fingerprint stays, so the next scan retries. */
function keepUnread(
  { result, seen }: ScanPass,
  row: FileRecord | undefined,
  path: string,
  reason: string,
) {
  if (row) seen.add(row.id);
  result.warnings.push(`Could not read ${path}: ${reason}`);
}

const rowsOf = (db: Db, batch: string[]) =>
  new Map(db.filesByPaths(batch).map((row) => [row.path, row]));

/** What `lstat` said about a path: nothing for a file that is gone, or why it could not say. */
type Stat = BigIntStats | undefined | Error;

/** A batch on its way in: its paths, their `lstat`s, and tag reads already under way. */
interface Prefetched {
  batch: string[];
  rowsByPath: Map<string, FileRecord>;
  /** `ScanPass.writes` when the rows were read. */
  writes: number;
  stats: Stat[];
  reads: Promise<TagRead[]>;
}

/**
 * Starts a batch's disk reads, so the tag worker runs during the previous batch's transaction. The
 * rows here may be one batch old, which is fine for guessing what to read: `scanBatch` decides what
 * a path is from the rows as they stand then, and reads whatever this missed.
 */
async function prefetch(db: Db, batch: string[], pass: ScanPass): Promise<Prefetched> {
  const rowsByPath = rowsOf(db, batch);
  const { writes } = pass;
  const stats = await Promise.all(
    batch.map((path) => ifExists(lstat(path, { bigint: true })).catch((error: Error) => error)),
  );
  const changed = batch.filter((path, index) => {
    const info = stats[index];
    if (!info || info instanceof Error || !info.isFile()) return false;
    const row = rowsByPath.get(path);
    return !row || !sameFingerprint(row, fingerprint(path, info));
  });
  return { batch, rowsByPath, writes, stats, reads: readScanTags(changed) };
}

/** Counts a path and marks its row seen. Returns its change, or `null` if it has none. */
async function detectChange(
  db: Db,
  path: string,
  info: Stat,
  rowAtPath: FileRecord | undefined,
  pass: ScanPass,
): Promise<Change | null> {
  try {
    if (info instanceof Error) throw info;
    if (!info?.isFile()) return null; // it can turn into a link after the walk saw it
    pass.result.files++;
    const onDisk = fingerprint(path, info);
    const prior = await priorRow(db, onDisk, rowAtPath);
    if (prior) pass.seen.add(prior.id);
    if (prior && sameFingerprint(prior, onDisk)) return null;
    return { onDisk, prior };
  } catch (error) {
    // A failed lstat never reached `seen`.
    keepUnread(pass, db.fileByPath(path) ?? rowAtPath, path, (error as Error).message);
    return null;
  }
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

/** Writes one change to the index. Synchronous, so that a batch is one transaction. */
function recordChange(db: Db, { onDisk, prior }: Change, tags: Tag[], { result, seen }: ScanPass) {
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

/** Records each change with its tag read. */
function recordChanges(db: Db, changes: Change[], reads: Map<string, TagRead>, pass: ScanPass) {
  changes.forEach((change) => {
    const read = reads.get(change.onDisk.path)!;
    if ('error' in read) keepUnread(pass, db.fileByPath(read.path), read.path, read.error);
    else recordChange(db, change, read.tags, pass);
  });
}

/** Handles one batch: async reads first, since a transaction must not span an `await`. */
async function scanBatch(db: Db, prefetched: Prefetched, pass: ScanPass) {
  const { batch, stats, reads } = prefetched;
  const rowsAreCurrent = prefetched.writes === pass.writes;
  const rowsByPath = rowsAreCurrent ? prefetched.rowsByPath : rowsOf(db, batch);
  const detected = await Promise.all(
    batch.map((path, index) => detectChange(db, path, stats[index], rowsByPath.get(path), pass)),
  );
  const changes = detected.filter((change) => change !== null);
  const tags = new Map((await reads).map((read) => [read.path, read]));
  const missed = changes.map(({ onDisk }) => onDisk.path).filter((path) => !tags.has(path));
  for (const read of await readScanTags(missed)) tags.set(read.path, read);
  if (changes.length) {
    db.transaction(() => recordChanges(db, changes, tags, pass));
    pass.writes++;
  }
  await yieldToLoop(); // SQLite writes must not keep other server requests waiting across batches
}

/** Walks a library and indexes what it finds, a batch at a time. */
async function walkAndIndex(
  db: Db,
  base: string,
  excluded: Excluded,
  onProgress?: OnProgress,
): Promise<ScanPass> {
  const pass = startPass();
  let batch: string[] = [];
  let previous: Prefetched | undefined;
  const scanPrevious = async () => {
    if (!previous) return;
    await scanBatch(db, previous, pass);
    const current = previous.batch.at(-1);
    if (current !== undefined) onProgress?.({ done: pass.result.files, current });
  };
  const scanQueued = async () => {
    const next = await prefetch(db, batch, pass);
    await scanPrevious();
    previous = next;
    batch = [];
  };
  for await (const path of walk(base, excluded, pass)) {
    batch.push(path);
    if (batch.length >= BATCH_SIZE) await scanQueued();
  }
  await scanQueued();
  await scanPrevious();
  return pass;
}

/** Deletes the rows of files the walk did not find. */
function dropMissingRows(
  db: Db,
  indexed: { id: number; path: string }[],
  { result, seen, unreadable }: ScanPass,
) {
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
  onProgress?: OnProgress,
): Promise<ScanResult> {
  const base = resolve(root);
  const baseInfo = await ifExists(stat(base));
  // Going on would read an unplugged drive as every file deleted, losing provenance and history.
  if (!baseInfo?.isDirectory()) throw new UserError(`${base} is not a folder that can be read`);

  // A stored root can be, or become, a link to a secret folder.
  const rootIsSecret = secretRoot(config, await realpath(base));
  const excluded = rootIsSecret ? () => true : exclusions(config, base);
  const pass = await walkAndIndex(db, base, excluded, onProgress);
  const { result } = pass;

  const indexed = db.filesUnder(base);
  // An empty mount point looks like every file deleted, and the rows hold provenance and history.
  // shortcut: a folder a person really emptied keeps its rows too, until `remove_library`.
  const mayBeUnplugged = result.files === 0 && indexed.length > 0;
  if (mayBeUnplugged) {
    result.warnings.push(
      `${base} has no files, but ${indexed.length} are indexed. Keeping them, in case a drive is unplugged`,
    );
    return result;
  }
  dropMissingRows(db, indexed, pass);
  db.markScanned(base);
  return result;
}

/** Splits watch events by what is on disk now, leaving out what is excluded. */
async function classifyCandidates(candidates: string[], excluded: Excluded) {
  const gone: string[] = [];
  const files: string[] = [];
  let hasDirectory = false;
  for (const path of candidates) {
    const info = await ifExists(lstat(path));
    if (excluded(path, info?.isDirectory() ?? false)) continue;
    if (!info) gone.push(path);
    else if (info.isDirectory()) hasDirectory = true;
    else if (info.isFile()) files.push(path);
  }
  return { gone, files, hasDirectory };
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
  const pass = startPass();
  const { gone, files, hasDirectory } = await classifyCandidates(candidates, excluded);
  for (let start = 0; start < files.length; start += BATCH_SIZE) {
    await scanBatch(db, await prefetch(db, files.slice(start, start + BATCH_SIZE), pass), pass);
  }
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
  db.upsertFile(fingerprint(path, await lstat(path, { bigint: true })), { edited: false });
}
