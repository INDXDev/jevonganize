/**
 * Keeps the index in step with the disk: walk, compare fingerprints, mirror tags. The disk always
 * wins. A fingerprint is what `lstat` says about a path, so an unchanged one needs no further read.
 * A row is a file the index knows; `seen` collects rows the walk found, and the rest are gone.
 *
 * A scan reads tags and writes only to the index, in batches, as a transaction must not span an
 * `await`: each batch reads the disk first, then records every observation at once.
 */
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import mime from 'mime';
import type { Tag } from '../types.ts';
import type { Config } from './config.ts';
import { ifExists, UserError } from './config.ts';
import type { Db, FileRecord, Fingerprint, MirrorTag } from './db.ts';
import { type Excluded, exclusions, secretRoot } from './exclusions.ts';
import { overwriteDropsTags } from './tags.ts';
import { readScanTags } from './tag-reader.ts';

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
    // shortcut: a real U+FFFD in a name is skipped too, read names as buffers if that ever matters.
    if (entry.name.includes('�')) {
      result.warnings.push(`Skipped a name that is not valid UTF-8 in ${dir}`);
      continue;
    }
    const isDirectory = entry.isDirectory();
    if (!isDirectory && !entry.isFile()) continue;
    const path = join(dir, entry.name);
    if (excluded(path, isDirectory)) result.skipped++;
    else if (isDirectory) yield* walk(path, excluded, result, unreadable);
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

const sameContent = (row: FileRecord, now: Fingerprint) =>
  row.ino === now.ino && row.size === now.size && row.mtime_ns === now.mtime_ns;

const sameFingerprint = (row: FileRecord, now: Fingerprint) =>
  row.path === now.path && sameContent(row, now) && row.ctime_ns === now.ctime_ns;

/** The row this path continues: its own, or that of a file that left its old path. */
async function priorRow(
  db: Db,
  now: Fingerprint,
  own: FileRecord | undefined,
): Promise<FileRecord | undefined> {
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
  own: FileRecord | undefined,
): Promise<Omit<Observation, 'tags'> | null> {
  try {
    const info = await ifExists(lstat(path, { bigint: true }));
    if (!info?.isFile()) return null; // it can turn into a link after the walk saw it
    result.files++;
    const now = fingerprint(path, info);
    const row = await priorRow(db, now, own);
    if (row) seen.add(row.id);
    if (row && sameFingerprint(row, now)) return null;
    return { now, row };
  } catch (error) {
    // The old fingerprint stays, so the next scan tries again. A failed lstat never reached `seen`.
    const latest = db.fileByPath(path) ?? own;
    if (latest) seen.add(latest.id);
    result.warnings.push(`Could not read ${path}: ${(error as Error).message}`);
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

/** Writes one observation to the index. Synchronous, so that a batch is one transaction. */
function recordObservation(
  db: Db,
  { now, row, tags }: Observation,
  result: ScanResult,
  seen: Set<number>,
) {
  const replaced = row !== undefined && row.ino !== now.ino;
  const edited = row !== undefined && !sameContent(row, now);
  const moved = row !== undefined && row.path !== now.path;
  if (moved) db.moveFile(row.id, now.path);
  const id = db.upsertFile(now, { edited, mime: mime.getType(now.path) });
  seen.add(id);

  const { added, removed } = db.syncFileTags(id, tags);
  const tagsWentWithContent = replaced || (edited && overwriteDropsTags);
  result.restores += recordRemoved(db, id, removed, tagsWentWithContent);
  db.dropRestored(id, tags);

  if (!row) result.added++;
  else if (moved) result.moved++;
  else if (edited || added.length || removed.length) result.changed++;
  result.ids.push(id);
}

/** Handles one batch: async reads first, since a transaction must not span an `await`. */
async function scanBatch(db: Db, batch: string[], result: ScanResult, seen: Set<number>) {
  const known = new Map(db.filesByPaths(batch).map((row) => [row.path, row]));
  const observed = (
    await Promise.all(batch.map((path) => observe(db, path, result, seen, known.get(path))))
  ).filter((item) => item !== null);
  const reads = await readScanTags(observed.map((item) => item.now.path));
  if (observed.length)
    db.transaction(() => {
      for (let index = 0; index < observed.length; index++) {
        const observation = observed[index]!;
        const read = reads[index]!;
        if ('error' in read) {
          const latest = db.fileByPath(read.path);
          if (latest) seen.add(latest.id);
          result.warnings.push(`Could not read ${read.path}: ${read.error}`);
          continue;
        }
        recordObservation(db, { ...observation, tags: read.tags }, result, seen);
      }
    });
  await yieldToLoop(); // SQLite writes must not keep other server requests waiting across batches
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

/** What walking a library found, for deciding which rows are gone. */
interface Walked {
  result: ScanResult;
  seen: Set<number>;
  unreadable: string[];
}

/** Walks a library and indexes what it finds, a batch at a time. */
async function walkAndIndex(
  db: Db,
  base: string,
  excluded: Excluded,
  onProgress?: (progress: { done: number; current: string }) => void,
): Promise<Walked> {
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
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return { result, seen, unreadable };
}

/** Deletes the rows of files the walk did not find. */
function dropMissingRows(
  db: Db,
  indexed: { id: number; path: string }[],
  { result, seen, unreadable }: Walked,
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
  onProgress?: (progress: { done: number; current: string }) => void,
): Promise<ScanResult> {
  const base = resolve(root);
  // Going on would read an unplugged drive as every file deleted, losing provenance and history.
  if (!(await ifExists(stat(base)))?.isDirectory()) {
    throw new UserError(`${base} is not a folder that can be read`);
  }
  // A stored root can be, or become, a link to a secret folder.
  const excluded = secretRoot(config, await realpath(base)) ? () => true : exclusions(config, base);
  const walked = await walkAndIndex(db, base, excluded, onProgress);
  const { result } = walked;

  const indexed = db.filesUnder(base);
  // An empty mount point looks like every file deleted, and the rows hold provenance and history.
  // shortcut: a folder a person really emptied keeps its rows too, until `remove_library`.
  if (result.files === 0 && indexed.length > 0) {
    result.warnings.push(
      `${base} has no files, but ${indexed.length} are indexed. Keeping them, in case a drive is unplugged`,
    );
    return result;
  }
  dropMissingRows(db, indexed, walked);
  db.markScanned(base);
  return result;
}

/** Sorts watch events by what is on disk now, leaving out what is excluded. */
async function sortCandidates(candidates: string[], excluded: Excluded) {
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
  const result = emptyResult();
  const { gone, files, hasDirectory } = await sortCandidates(candidates, excluded);
  for (let start = 0; start < files.length; start += BATCH_SIZE) {
    await scanBatch(db, files.slice(start, start + BATCH_SIZE), result, new Set());
  }
  // After the files, so a rename seen whole in this batch has already moved its row.
  const isIndexed = (path: string) => db.fileByPath(path) || db.filesUnder(path).length > 0;
  const needsWalk = hasDirectory || gone.some(isIndexed);
  return { ids: result.ids, needsWalk, warnings: result.warnings };
}

/**
 * Stores a file's fingerprint straight after the app wrote its tags, so the scan and the watcher
 * do not take the moved ctime for an outside change.
 */
export async function recordWrite(db: Db, path: string): Promise<void> {
  db.upsertFile(fingerprint(path, await lstat(path, { bigint: true })), { edited: false });
}
