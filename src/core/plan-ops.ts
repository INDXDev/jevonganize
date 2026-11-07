/**
 * One op against one file: the checks, the merge, the tag write and the index mirror. Only
 * `plans.ts` runs `applyOp` and `undoOp`, so every tag write still goes through a plan. See
 * docs/tags.md.
 *
 * The file's tags are the truth and the index only mirrors them, so the code keeps two lists apart:
 * `diskTags`, read from the file now, and what the index recorded earlier. A stamp identifies a
 * file's content, which tells a plan made for one version of a file from another version.
 */
import type { BigIntStats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import type { Plan, Tag, TagOp } from '../types.ts';
import { UserError } from './config.ts';
import type { Db, FileRecord } from './db.ts';
import { type ApplyRules, conflictReason } from './plan-conflicts.ts';
import { recordRemoved } from './scan-record.ts';
import { recordWrite } from './scan.ts';
import { normalize } from './tag-rules.ts';
import { overwriteDropsTags, readTags, writeTags } from './tags.ts';

/** The tags one op adds to and removes from a file. */
type TagDelta = Pick<TagOp, 'add' | 'remove'>;

/** Identifies a file's content, which a tag write leaves alone. */
export const contentStamp = (file: { ino: string; size: number; mtime_ns: string }) =>
  `${file.ino}:${file.size}:${file.mtime_ns}`;

/** The fields of `contentStamp`, as `lstat` reports them. */
export const statFields = (info: BigIntStats) => ({
  ino: String(info.ino),
  size: Number(info.size),
  mtime_ns: String(info.mtimeNs),
});

/** True when an op would add or remove at least one tag. */
export const hasTagChanges = ({ add, remove }: TagDelta) => add.length > 0 || remove.length > 0;

/** Organize plans hold the model's answers; every other source is a person's decision. */
const isAiPlan = (plan: Plan) => plan.source === 'organize';

/** Checks one op against the file as it is now, and merges it in. Returns what really changed. */
export async function applyOp(db: Db, op: TagOp, plan: Plan, rules: ApplyRules): Promise<TagOp> {
  const file = requireIndexedFile(db, op.file_id);
  const { diskTags, aiTags } = await checkOpStillHolds(db, file, op, rules);
  const byAi = isAiPlan(plan);
  const changed = await writeMerged(db, file, diskTags, {
    add: op.add,
    remove: op.remove,
    ai: byAi,
  });
  if (!byAi) {
    // A person took off a tag the model gave, so organize must not put it back.
    const aiTagsRemoved = changed.remove.filter((tag) => aiTags.includes(tag));
    for (const tag of aiTagsRemoved) db.rejectTag(file.id, tag, 'Removed by a person');
  }
  return { file_id: file.id, ...changed };
}

/** Reverses one applied op, unless a later change to the file overtook it. */
export async function undoOp(db: Db, op: TagOp, plan: Plan): Promise<void> {
  const file = requireIndexedFile(db, op.file_id);
  const diskTags = await readTags(file.path);
  const isSwap = op.add.length > 0 && op.remove.length > 0;
  const everyAddedTagGone = !op.add.some((tag) => diskTags.includes(tag));
  if (isSwap && everyAddedTagGone) {
    throw new UserError('The tags on this file changed after the plan ran');
  }
  const reversal = { add: op.remove, remove: op.add, ai: isAiPlan(plan) };
  const { add: restored } = await writeMerged(db, file, diskTags, reversal);
  for (const tag of restored) db.unrejectTag(file.id, tag);
}

/** The file's index row, or a user error when it has left the index since. */
function requireIndexedFile(db: Db, id: number): FileRecord {
  const file = db.fileById(id);
  if (!file) throw new UserError('The file is no longer in the index');
  return file;
}

/** The tags on a file that an applied organize plan put there. */
const aiTagsOf = (db: Db, id: number) =>
  db
    .fileTags(id)
    .filter((row) => row.ai)
    .map((row) => row.tag);

/**
 * Throws when the op no longer fits the file: it is not a regular file now, or its content or tags
 * moved on in a way `conflictReason` refuses. Returns the tags read from disk and the AI tags.
 */
async function checkOpStillHolds(db: Db, file: FileRecord, op: TagOp, rules: ApplyRules) {
  // Re-checked at write time: the path may have become a symlink or a folder since the scan.
  const info = await lstat(file.path, { bigint: true });
  if (!info.isFile()) throw new UserError(`${file.path} is not a regular file`);
  const diskTags = await readTags(file.path);
  const stamp = contentStamp(statFields(info));
  const aiTags = aiTagsOf(db, file.id);
  const indexed = { aiTags, rejected: db.rejectedTags(file.id) };
  const conflict = conflictReason(op, { diskTags, stamp }, indexed, rules);
  if (conflict) throw new UserError(conflict);
  return { diskTags, aiTags };
}

/** Merges into the file, then mirrors the result in the index. Returns what really changed. */
async function writeMerged(
  db: Db,
  file: FileRecord,
  diskTags: Tag[],
  request: TagDelta & { ai: boolean },
): Promise<TagDelta> {
  const { merged, add, remove } = mergeTags(diskTags, request);
  const changesDisk = hasTagChanges({ add, remove });
  const { replaced } = changesDisk
    ? await writeAndRecord(db, file, merged)
    : await changeSinceScan(file);
  db.transaction(() => {
    db.addFileTags(file.id, add, request.ai);
    db.removeFileTags(file.id, remove);
    const { removed } = db.syncFileTags(file.id, merged);
    // The scan will not see these go, as the mirror has just caught up, so they are handled here.
    const removedElsewhere = removed.filter(({ tag }) => !request.remove.includes(tag));
    recordRemoved(db, file.id, removedElsewhere, replaced);
  });
  return { add, remove };
}

/** The merge from docs/tags.md: the tags a file ends up with, and how they differ from `diskTags`. */
function mergeTags(diskTags: Tag[], request: TagDelta) {
  const isKept = (tag: Tag) => !request.remove.includes(tag);
  const merged = normalize([...diskTags, ...request.add].filter(isKept));
  return {
    merged,
    add: merged.filter((tag) => !diskTags.includes(tag)),
    remove: diskTags.filter((tag) => !merged.includes(tag)),
  };
}

/** How the file on disk differs from its index row. A tag write alone is neither of these. */
interface ChangeSinceScan {
  /** Its content changed. */
  edited: boolean;
  /** It is another file now: a new inode, or an overwrite that dropped its tags. */
  replaced: boolean;
}

async function changeSinceScan(file: FileRecord): Promise<ChangeSinceScan> {
  const now = statFields(await lstat(file.path, { bigint: true }));
  const edited = contentStamp(now) !== contentStamp(file);
  const replaced = now.ino !== file.ino || (edited && overwriteDropsTags);
  return { edited, replaced };
}

/** Writes the tags to the file, and refreshes its index row unless the file was edited meanwhile. */
async function writeAndRecord(db: Db, file: FileRecord, tags: Tag[]): Promise<ChangeSinceScan> {
  await writeTags(file.path, tags);
  const sinceScan = await changeSinceScan(file);
  // The file was edited behind the index. A new fingerprint would hide that from the next scan.
  if (!sinceScan.edited) await recordWrite(db, file.path);
  return sinceScan;
}
