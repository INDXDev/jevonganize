/**
 * Keeps the index in step with the disk. The disk always wins, and a scan writes only to the index.
 *
 * A full scan walks a library, hands its paths to scan-batch.ts in batches, and once the walk ends
 * deletes the rows of files it did not find. `scanPaths` does the same for the few paths a watcher
 * reports, and leaves deletes to a full scan. The file reads from top to bottom: the entry points
 * first, then the walk, then the end of a scan.
 */
import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Config } from './config.ts';
import { ifExists, UserError } from './config.ts';
import type { Db } from './db.ts';
import { type Excluded, exclusions, secretRoot } from './exclusions.ts';
import { fingerprint } from './fingerprint.ts';
import { batchesOf, type Prefetched, prefetch, scanBatch, startPass } from './scan-batch.ts';
import type { ScanPass, ScanResult } from './scan-record.ts';

/** Reports how far a scan has got. */
type OnProgress = (progress: { done: number; current: string }) => void;

/** Indexed rows under a library, as `dropMissingRows` checks them. */
type IndexedRow = { id: number; path: string };

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

  const indexed = db.filesUnder(root);
  if (mayBeUnplugged(pass, root, indexed)) return pass.result;
  dropMissingRows(indexed, pass);
  db.markScanned(root);
  return pass.result;
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
 * True, with a warning, when the walk found no files where the index has some. An empty mount
 * point looks like every file deleted, and the rows hold provenance and history.
 */
// shortcut: a folder a person really emptied keeps its rows too, until `remove_library`.
function mayBeUnplugged({ result }: ScanPass, root: string, indexed: IndexedRow[]): boolean {
  if (result.files > 0 || indexed.length === 0) return false;
  result.warnings.push(
    `${root} has no files, but ${indexed.length} are indexed. Keeping them, in case a drive is unplugged`,
  );
  return true;
}

/** Deletes the rows of files the walk did not find. */
function dropMissingRows(indexed: IndexedRow[], pass: ScanPass) {
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
