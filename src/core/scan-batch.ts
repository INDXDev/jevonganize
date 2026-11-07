/**
 * One batch of a scan, from paths on disk to rows in the index. A batch exists because a transaction
 * must not span an `await`, so the disk reads come first and the index writes after. It has three
 * steps:
 *
 * 1. `prefetch` runs `lstat` on every path and starts reading the tags of those that look changed.
 * 2. `detectChanges` compares each path with its row, and marks the row as seen.
 * 3. `recordChanges`, in scan-record.ts, writes every difference to the index in one transaction.
 *
 * A row is a file the index knows. A fingerprint is what `lstat` says about a path, so a file whose
 * fingerprint matches its row needs no further read.
 */
import type { BigIntStats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { ifExists } from './config.ts';
import type { Db, FileRecord, Fingerprint } from './db.ts';
import { fingerprint, sameFingerprint } from './fingerprint.ts';
import { type Change, keepUnread, recordChanges, type ScanPass } from './scan-record.ts';
import { readScanTags, type TagRead } from './tag-reader.ts';

const BATCH_SIZE = 256;

/** A path and what `lstat` said about it. */
interface PathStats {
  path: string;
  /** `undefined` for a file that is gone, and the error when `lstat` could not say. */
  stats: BigIntStats | undefined | Error;
}

/** A batch on its way in: its `lstat`s, the rows they were compared with, and tag reads under way. */
export interface Prefetched {
  pathStats: PathStats[];
  rowsByPath: Map<string, FileRecord>;
  /** `ScanPass.batchesWritten` when the rows were read. */
  batchesWrittenBefore: number;
  tagReads: Promise<TagRead[]>;
}

/** A pass that has found nothing yet. */
export const startPass = (db: Db): ScanPass => ({
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
  batchesWritten: 0,
});

/** Groups paths into batches, none of them empty. */
export async function* batchesOf(paths: Iterable<string> | AsyncIterable<string>) {
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

/**
 * Step 1. Starts a batch's disk reads, so the tag worker runs during the previous batch's
 * transaction. The rows here may be one batch old, which is fine for guessing what to read:
 * `detectChanges` decides what a path is from the rows as they stand then, and `tagReadsForChanges`
 * reads whatever this missed.
 */
export async function prefetch(batch: string[], pass: ScanPass): Promise<Prefetched> {
  const rowsByPath = rowsByPathOf(pass.db, batch);
  const batchesWrittenBefore = pass.batchesWritten;
  const pathStats = await Promise.all(batch.map(lstatOrError));
  const looksChanged = ({ path, stats }: PathStats) => {
    if (!stats || stats instanceof Error || !stats.isFile()) return false;
    const row = rowsByPath.get(path);
    return !row || !sameFingerprint(row, fingerprint(path, stats));
  };
  const changedPaths = pathStats.filter(looksChanged).map(({ path }) => path);
  return { pathStats, rowsByPath, batchesWrittenBefore, tagReads: readScanTags(changedPaths) };
}

const rowsByPathOf = (db: Db, paths: string[]) =>
  new Map(db.filesByPaths(paths).map((row) => [row.path, row]));

const lstatOrError = async (path: string): Promise<PathStats> => ({
  path,
  stats: await ifExists(lstat(path, { bigint: true })).catch((error: Error) => error),
});

/** Takes one prefetched batch through steps 2 and 3, to the index. */
export async function scanBatch(prefetched: Prefetched, pass: ScanPass) {
  const changes = await detectChanges(prefetched, pass);
  const tagReads = await tagReadsForChanges(await prefetched.tagReads, changes);
  if (changes.length) {
    pass.db.transaction(() => recordChanges(changes, tagReads, pass));
    pass.batchesWritten++;
  }
  await yieldToLoop(); // SQLite writes must not keep other server requests waiting across batches
}

/** Step 2. Compares a batch with the rows as they stand now, after any earlier batch's writes. */
async function detectChanges(prefetched: Prefetched, pass: ScanPass): Promise<Change[]> {
  const { pathStats } = prefetched;
  const rowsAreCurrent = prefetched.batchesWrittenBefore === pass.batchesWritten;
  const paths = pathStats.map(({ path }) => path);
  const rowsByPath = rowsAreCurrent ? prefetched.rowsByPath : rowsByPathOf(pass.db, paths);
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
  if (stats instanceof Error) return skipUnreadable(pass, path, rowAtPath, stats);
  if (!stats?.isFile()) return null; // it can turn into a link after the walk saw it

  pass.result.files++;
  const onDisk = fingerprint(path, stats);
  const previous = await previousRow(pass.db, onDisk, rowAtPath).catch((error: Error) => error);
  if (previous instanceof Error) return skipUnreadable(pass, path, rowAtPath, previous);
  if (previous) pass.seen.add(previous.id);
  const unchanged = previous && sameFingerprint(previous, onDisk);
  return unchanged ? null : { onDisk, previous };
}

/** Keeps the row of a path that could not be read, and reports no change for it. */
function skipUnreadable(
  pass: ScanPass,
  path: string,
  rowAtPath: FileRecord | undefined,
  error: Error,
): null {
  // The failure came before the row was marked seen, so it is kept here instead.
  keepUnread(pass, pass.db.fileByPath(path) ?? rowAtPath, path, error.message);
  return null;
}

/** The row this path continues: its own, or that of a file that left its old path. */
async function previousRow(db: Db, onDisk: Fingerprint, rowAtPath: FileRecord | undefined) {
  if (rowAtPath) return rowAtPath;
  for (const row of db.filesByInode(onDisk.dev, onDisk.ino)) {
    const oldPathIsEmpty = !(await ifExists(lstat(row.path)));
    if (oldPathIsEmpty) return row; // a file still at its old path is a hard link, not a move
  }
  return undefined;
}

/** The tag reads of every change by path: the prefetched ones, plus any the prefetch missed. */
async function tagReadsForChanges(prefetched: TagRead[], changes: Change[]) {
  const readsByPath = new Map(prefetched.map((read) => [read.path, read]));
  const changedPaths = changes.map(({ onDisk }) => onDisk.path);
  const missed = changedPaths.filter((path) => !readsByPath.has(path));
  for (const read of await readScanTags(missed)) readsByPath.set(read.path, read);
  return readsByPath;
}
