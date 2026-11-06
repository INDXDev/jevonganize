/**
 * Propose, apply, undo: every tag write in the app happens here. See docs/tags.md.
 *
 * A plan is a stored list of ops, and an op says which tags to add to and remove from one file.
 * Proposing stores a plan and writes nothing. Applying merges each op into the tags read fresh from
 * the file, then keeps only what really changed. Undoing runs the same merge the other way round.
 *
 * The file's tags are the truth and the index only mirrors them, so the code keeps two lists apart:
 * `diskTags`, read from the file now, and what the index recorded earlier. A stamp identifies a
 * file's content, which tells a plan made for one version of a file from another version.
 */
import { randomBytes } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { FileQuery, Job, Plan, ReviewItem, Tag, TagOp } from '../types.ts';
import { errorMessage, UserError } from './config.ts';
import type { Db, FileRecord } from './db.ts';
import { type ApplyRules, conflictReason } from './plan-conflicts.ts';
import { recordRemoved, recordWrite } from './scan.ts';
import { normalize, overwriteDropsTags, readTags, validTags, writeTags } from './tags.ts';

/** What a flow gets from the job running it. */
export interface JobRun {
  signal: AbortSignal;
  update(patch: Partial<Job>): void;
}

const YIELD_EVERY = 64;
/** A claim with no sign of life for this long belongs to a run that died. */
const CLAIM_STALE_MS = 120_000;

type Source = Plan['source'];

/** Identifies a file's content, which a tag write leaves alone. */
export const contentStamp = (file: { ino: string; size: number; mtime_ns: string }) =>
  `${file.ino}:${file.size}:${file.mtime_ns}`;

/** The fields of `contentStamp`, as `lstat` reports them. */
export const statFields = (info: BigIntStats) => ({
  ino: String(info.ino),
  size: Number(info.size),
  mtime_ns: String(info.mtimeNs),
});

const isAiPlan = (plan: Plan) => plan.source === 'organize';

const hasTagChanges = ({ add, remove }: Pick<TagOp, 'add' | 'remove'>) =>
  add.length > 0 || remove.length > 0;

function countTags(tags: Tag[], into: Record<Tag, number>): void {
  for (const tag of tags) into[tag] = (into[tag] ?? 0) + 1;
}

function summarizeOps(ops: TagOp[]): Plan['summary'] {
  const summary: Plan['summary'] = { files: ops.length, added: {}, removed: {} };
  for (const op of ops) {
    countTags(op.add, summary.added);
    countTags(op.remove, summary.removed);
  }
  return summary;
}

/** Stores a plan. Ops that change nothing are dropped. No tag changes here. */
export function proposePlan(db: Db, title: string, source: Source, ops: TagOp[]): Plan {
  const kept = ops.filter(hasTagChanges);
  const plan: Plan = {
    id: randomBytes(4).toString('hex'),
    title,
    source,
    status: 'proposed',
    created_at: Date.now(),
    ops: kept,
    summary: summarizeOps(kept),
  };
  db.savePlan(plan);
  return plan;
}

function filesById(db: Db, ids: number[]) {
  return ids.map((id) => {
    const file = db.fileRow(id);
    if (!file) throw new UserError(`There is no file with id ${id}`);
    return file;
  });
}

/** Plans a change to the files of a query, or to files by id. */
export function proposeChanges(
  db: Db,
  input: {
    query?: FileQuery;
    file_ids?: number[];
    add?: Tag[];
    remove?: Tag[];
    title: string;
  },
  source: Source,
): Plan {
  const { query, file_ids, title, remove = [] } = input;
  const add = validTags(input.add ?? []); // `writeTags` has the last word
  if (add.length === 0 && remove.length === 0) throw new UserError('Nothing to add or remove');
  const hasOneTarget = (query === undefined) !== (file_ids === undefined);
  if (!hasOneTarget) throw new UserError('Give either a query or file_ids');
  const files = query ? db.searchFiles(query).files : filesById(db, file_ids ?? []);
  const ops = files.map(({ id, tags }) => ({
    file_id: id,
    add: add.filter((tag) => !tags.includes(tag)),
    remove: remove.filter((tag) => tags.includes(tag)),
  }));
  return proposePlan(db, title, source, ops);
}

/** Plans a rename on every file that has the tag. `from` is unchecked, so a bad one can be fixed. */
export function proposeRename(db: Db, from: Tag, to: Tag, source: Source): Plan {
  const [target = ''] = validTags([to]);
  if (!target) throw new UserError('The new tag is empty');
  const ops = db.filesWithTag(from).map((file_id) => ({
    file_id,
    add: [target],
    remove: [from],
  }));
  return proposePlan(db, `rename ${from} to ${target}`, source, ops);
}

/** Plans the accepted review items. A person vouched for them, so they are not marked as AI. */
export function proposeReviews(db: Db, items: ReviewItem[], source: Source): Plan {
  const byFile = new Map<number, Tag[]>();
  for (const { file_id, tag } of items) byFile.set(file_id, [...(byFile.get(file_id) ?? []), tag]);
  const ops = [...byFile].map(([file_id, add]) => ({ file_id, add, remove: [] }));
  return proposePlan(db, `Accept ${items.length} review items`, source, ops);
}

/** The merge from docs/tags.md: the tags a file ends up with, and how they differ from `diskTags`. */
function mergeTags(diskTags: Tag[], change: { add: Tag[]; remove: Tag[] }) {
  const isKept = (tag: Tag) => !change.remove.includes(tag);
  const merged = normalize([...diskTags, ...change.add].filter(isKept));
  return {
    merged,
    add: merged.filter((tag) => !diskTags.includes(tag)),
    remove: diskTags.filter((tag) => !merged.includes(tag)),
  };
}

/** How the file on disk differs from its index row. A tag write alone is neither of these. */
async function compareWithRow(file: FileRecord) {
  const now = statFields(await lstat(file.path, { bigint: true }));
  const edited = contentStamp(now) !== contentStamp(file);
  const replaced = now.ino !== file.ino || (edited && overwriteDropsTags);
  return { edited, replaced };
}

async function writeAndRecord(db: Db, file: FileRecord, tags: Tag[]) {
  await writeTags(file.path, tags);
  const difference = await compareWithRow(file);
  // The file was edited behind the index. A new fingerprint would hide that from the next scan.
  if (!difference.edited) await recordWrite(db, file.path);
  return difference;
}

/** Merges into the file, then mirrors the result in the index. Returns what really changed. */
async function writeMerged(
  db: Db,
  file: FileRecord,
  diskTags: Tag[],
  change: { add: Tag[]; remove: Tag[]; ai: boolean },
): Promise<{ add: Tag[]; remove: Tag[] }> {
  const { merged, add, remove } = mergeTags(diskTags, change);
  const { replaced } = hasTagChanges({ add, remove })
    ? await writeAndRecord(db, file, merged)
    : await compareWithRow(file);
  db.transaction(() => {
    db.addFileTags(file.id, add, change.ai);
    db.removeFileTags(file.id, remove);
    const { removed } = db.syncFileTags(file.id, merged);
    // The scan will not see these go, as the mirror has just caught up, so they are handled here.
    const missing = removed.filter(({ tag }) => !change.remove.includes(tag));
    recordRemoved(db, file.id, missing, replaced);
  });
  return { add, remove };
}

function requireIndexedFile(db: Db, id: number): FileRecord {
  const file = db.fileById(id);
  if (!file) throw new UserError('The file is no longer in the index');
  return file;
}

const aiTagsOf = (db: Db, id: number) =>
  db
    .fileTags(id)
    .filter((row) => row.ai)
    .map((row) => row.tag);

/** Checks one op against the file as it is now, and merges it in. Returns what really changed. */
async function applyOp(db: Db, op: TagOp, plan: Plan, rules: ApplyRules): Promise<TagOp> {
  const file = requireIndexedFile(db, op.file_id);
  const info = await lstat(file.path, { bigint: true });
  if (!info.isFile()) throw new UserError(`${file.path} is not a regular file`);
  const diskTags = await readTags(file.path);
  const stamp = contentStamp(statFields(info));
  const aiTags = aiTagsOf(db, file.id);
  const indexed = { aiTags, rejected: db.rejectedTags(file.id) };
  const reason = conflictReason(op, { diskTags, stamp }, indexed, rules);
  if (reason) throw new UserError(reason);

  const ai = isAiPlan(plan);
  const change = { add: op.add, remove: op.remove, ai };
  const changed = await writeMerged(db, file, diskTags, change);
  const removedByPerson = ai ? [] : changed.remove.filter((tag) => aiTags.includes(tag));
  for (const tag of removedByPerson) db.rejectTag(file.id, tag, 'Removed by a person');
  return { file_id: file.id, ...changed };
}

type OpErrors = Record<number, string>;

/** Why an op did not run, or undefined when it did. A failure stays with its own file. */
async function opFailure(
  op: TagOp,
  job: JobRun,
  work: (op: TagOp) => Promise<void>,
): Promise<string | undefined> {
  if (job.signal.aborted) return 'Cancelled';
  try {
    await work(op);
    return undefined;
  } catch (error) {
    return errorMessage(error);
  }
}

/** Runs ops one by one. A failed op is recorded, and the rest continue. */
async function runOps(
  todo: TagOp[],
  job: JobRun,
  work: (op: TagOp) => Promise<void>,
  onBatch?: () => void,
): Promise<OpErrors> {
  const errors: OpErrors = {};
  let done = 0;
  for (const op of todo) {
    const failure = await opFailure(op, job, work);
    if (failure !== undefined) errors[op.file_id] = failure;
    done++;
    job.update({ done });
    if (done % YIELD_EVERY === 0) {
      onBatch?.();
      await yieldToLoop();
    }
  }
  return errors;
}

/** Gives back plans whose apply died. What they wrote stays in `plan_op`, for the next apply. */
export const recoverPlans = (db: Db) => db.releasePlans(Date.now() - CLAIM_STALE_MS);

/** Takes a plan for applying. Atomic, so two callers, even in two processes, cannot both run it. */
export function claimPlan(db: Db, id: string): Plan {
  recoverPlans(db);
  const claimed = db.claimPlan(id, Date.now());
  const plan = db.getPlan(id);
  if (!plan) throw new UserError(`There is no plan ${id}`);
  if (claimed) return plan;
  const hint = plan.status === 'applying' ? '. If that run crashed, try again in two minutes' : '';
  throw new UserError(`Plan ${id} is ${plan.status}${hint}`);
}

/** A plan after an apply: `ops` hold what really changed, and only a run with none of them failed. */
function finishedPlan(plan: Plan, ops: TagOp[], errors: OpErrors): Plan {
  const failed = Object.keys(errors).length > 0;
  return {
    ...plan,
    status: failed && ops.length === 0 ? 'failed' : 'applied',
    ops,
    summary: summarizeOps(ops),
    ...(failed && { errors }),
  };
}

/**
 * Applies a claimed plan, merging into a fresh read of each file. The stored ops become what really
 * changed, so undo reverses only that. Cancelling leaves what ran applied and undoable. Each write
 * is recorded as it happens, so a crash loses no undo: the next apply picks up from those records.
 */
export async function applyPlan(db: Db, plan: Plan, rules: ApplyRules, job: JobRun): Promise<Plan> {
  const ops = db.planOps(plan.id);
  const recordedFiles = new Set(ops.map((op) => op.file_id));
  const todo = plan.ops.filter((op) => !recordedFiles.has(op.file_id));
  const applyAndRecord = async (op: TagOp) => {
    const changed = await applyOp(db, op, plan, rules);
    if (!hasTagChanges(changed)) return;
    db.addPlanOp(plan.id, changed);
    ops.push(changed);
  };
  const keepClaim = () => db.touchPlan(plan.id, Date.now());
  const errors = await runOps(todo, job, applyAndRecord, keepClaim);

  if (job.signal.aborted && ops.length === 0) {
    const proposed: Plan = { ...plan, status: 'proposed' }; // nothing ran, so it can still run
    db.savePlan(proposed);
    return proposed;
  }
  const finished = finishedPlan(plan, ops, errors);
  db.transaction(() => {
    db.savePlan(finished);
    db.clearPlanOps(plan.id);
  });
  return finished;
}

async function undoOp(db: Db, op: TagOp, plan: Plan): Promise<void> {
  const file = requireIndexedFile(db, op.file_id);
  const diskTags = await readTags(file.path);
  const isSwap = op.add.length > 0 && op.remove.length > 0;
  const overtaken = isSwap && !op.add.some((tag) => diskTags.includes(tag));
  if (overtaken) throw new UserError('The tags on this file changed after the plan ran');
  const reversal = { add: op.remove, remove: op.add, ai: isAiPlan(plan) };
  const { add } = await writeMerged(db, file, diskTags, reversal);
  for (const tag of add) db.unrejectTag(file.id, tag);
}

/**
 * Reverses an applied plan with the same merge. A tag someone added since stays. An op whose tags
 * have all gone was overtaken, so what it removed is not put back on top of a later decision. A
 * plan with ops left, cancelled or failed, stays `applied` and holds only those, so undo can finish.
 */
export async function undoPlan(db: Db, plan: Plan, job: JobRun): Promise<Plan> {
  const errors = await runOps(plan.ops, job, (op) => undoOp(db, op, plan));
  const opsLeft = plan.ops.filter((op) => op.file_id in errors);
  const finished: Plan =
    opsLeft.length > 0
      ? { ...plan, ops: opsLeft, summary: summarizeOps(opsLeft), errors }
      : { ...plan, status: 'undone', errors: undefined };
  db.savePlan(finished);
  return finished;
}
