/**
 * Step 3 of a scan batch, and what a tag write shares with it: recording on the index what was
 * found on disk. The file's tags are the truth, so a change syncs the index's mirror of them, and a
 * tag that disappeared is handled as docs/tags.md#lost-tags says. Nothing here touches a file.
 */
import mime from 'mime';
import type { Tag } from '../types.ts';
import type { Db, FileRecord, Fingerprint, MirrorTag } from './db.ts';
import { contentLooksSame } from './fingerprint.ts';
import type { TagRead } from './tag-reader.ts';
import { overwriteDropsTags } from './tags.ts';

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

/** One scan: the index it updates and what it has learned so far. */
export interface ScanPass {
  db: Db;
  result: ScanResult;
  /** Ids of the rows whose file was found. */
  seen: Set<number>;
  /** Folders that could not be listed. */
  unreadable: string[];
  /** Batches that wrote to the index, which tells whether rows read earlier still hold. */
  batchesWritten: number;
}

/** A file that differs from the index. `previous` is unset for a file the index has not met. */
export interface Change {
  onDisk: Fingerprint;
  /** The row the file continues: at its path, or at the path it moved from. */
  previous: FileRecord | undefined;
}

/** Records each change with its tag read. Synchronous, so a batch is one transaction. */
export function recordChanges(
  changes: Change[],
  readsByPath: Map<string, TagRead>,
  pass: ScanPass,
) {
  for (const change of changes) {
    const read = readsByPath.get(change.onDisk.path)!; // tagReadsForChanges covers every change
    if ('error' in read) keepUnread(pass, pass.db.fileByPath(read.path), read.path, read.error);
    else recordChange(change, read.tags, pass);
  }
}

/** Writes one change to the index. */
function recordChange({ onDisk, previous }: Change, tags: Tag[], pass: ScanPass) {
  const { db, result, seen } = pass;
  const replaced = previous !== undefined && previous.ino !== onDisk.ino;
  const edited = previous !== undefined && !contentLooksSame(previous, onDisk);
  const moved = previous !== undefined && previous.path !== onDisk.path;
  if (moved) db.moveFile(previous.id, onDisk.path);
  const id = db.upsertFile(onDisk, { edited, mime: mime.getType(onDisk.path) });
  seen.add(id);

  const { added, removed } = db.syncFileTags(id, tags);
  const tagsWentWithContent = replaced || (edited && overwriteDropsTags);
  result.restores += recordRemoved(db, id, removed, tagsWentWithContent);
  db.dropRestored(id, tags);

  const tagsChanged = added.length > 0 || removed.length > 0;
  if (!previous) result.added++;
  else if (moved) result.moved++;
  else if (edited || tagsChanged) result.changed++;
  result.ids.push(id);
}

/** Keeps a row whose file could not be read: its old fingerprint stays, so the next scan retries. */
export function keepUnread(
  pass: ScanPass,
  row: FileRecord | undefined,
  path: string,
  reason: string,
) {
  if (row) pass.seen.add(row.id);
  pass.result.warnings.push(`Could not read ${path}: ${reason}`);
}

/**
 * Handles tags gone from a file, as in docs/tags.md#lost-tags. An app tag a person removed is not
 * proposed again, and a tag lost with replaced content becomes a `restore` item. Returns how many
 * `restore` items are new.
 */
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
