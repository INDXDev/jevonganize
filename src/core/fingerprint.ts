/** Fingerprints: what `lstat` says about a file, and how that compares with its row in the index. */
import type { BigIntStats } from 'node:fs';
import type { FileRecord, Fingerprint } from './db.ts';

/** What `lstat` says about a path, in the form the index stores. */
export const fingerprint = (path: string, stats: BigIntStats): Fingerprint => ({
  path,
  dev: String(stats.dev),
  ino: String(stats.ino),
  size: Number(stats.size),
  mtime_ns: String(stats.mtimeNs),
  ctime_ns: String(stats.ctimeNs),
});

/** Judged from the fingerprint alone: the content itself is never read here. */
export const contentLooksSame = (row: FileRecord, onDisk: Fingerprint) =>
  row.ino === onDisk.ino && row.size === onDisk.size && row.mtime_ns === onDisk.mtime_ns;

/** Whether a row still describes this path exactly, so the file needs no further read. */
export const sameFingerprint = (row: FileRecord, onDisk: Fingerprint) =>
  row.path === onDisk.path && contentLooksSame(row, onDisk) && row.ctime_ns === onDisk.ctime_ns;
