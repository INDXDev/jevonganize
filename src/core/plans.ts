/**
 * Propose, apply, undo: every tag write in the app happens here. See docs/tags.md.
 *
 * A plan is a stored list of ops, and an op says which tags to add to and remove from one file.
 * Proposing stores a plan and writes nothing. Applying merges each op into the tags read fresh from
 * the file, then keeps only what really changed. Undoing runs the same merge the other way round.
 * What happens to each file is in `plan-ops.ts`; this module runs the ops and keeps the plan.
 */
import { randomBytes } from 'node:crypto';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { FileQuery, Job, Plan, ReviewItem, Tag, TagOp } from '../types.ts';
import { errorMessage, UserError } from './config.ts';
import type { Db } from './db.ts';
import type { ApplyRules } from './plan-conflicts.ts';
import { applyOp, hasTagChanges, undoOp } from './plan-ops.ts';
import { restoreFollowed, withRenamesFollowed } from './tag-followers.ts';
import { validTags } from './tag-rules.ts';

/** What a flow gets from the job running it. */
export interface JobRun {
  /** The job's id, which usage rows name. Left out by runs that belong to no job. */
  id?: string;
  signal: AbortSignal;
  update(patch: Partial<Job>): void;
}

/** Ops between yields to the event loop, so a long apply leaves the server responsive. */
const YIELD_EVERY = 64;
/** A claim with no sign of life for this long belongs to a run that died. */
const CLAIM_STALE_MS = 120_000;

type PlanSource = Plan['source'];

/** Adds one to each tag's count. */
function countTags(tags: Tag[], countByTag: Record<Tag, number>): void {
  for (const tag of tags) countByTag[tag] = (countByTag[tag] ?? 0) + 1;
}

/** How many files the ops touch, and how often each tag is added and removed. */
function summarizeOps(ops: TagOp[]): Plan['summary'] {
  const summary: Plan['summary'] = { files: ops.length, added: {}, removed: {} };
  for (const op of ops) {
    countTags(op.add, summary.added);
    countTags(op.remove, summary.removed);
  }
  return summary;
}

/** Stores a plan. Ops that change nothing are dropped. No tag changes here. */
export function proposePlan(db: Db, title: string, source: PlanSource, ops: TagOp[]): Plan {
  const changingOps = ops.filter(hasTagChanges);
  const plan: Plan = {
    id: randomBytes(4).toString('hex'),
    title,
    source,
    status: 'proposed',
    created_at: Date.now(),
    ops: changingOps,
    summary: summarizeOps(changingOps),
  };
  db.savePlan(plan);
  return plan;
}

/** The index rows of these ids, throwing on the first id the index does not have. */
function filesById(db: Db, ids: number[]) {
  return ids.map((id) => {
    const file = db.fileRow(id);
    if (!file) throw new UserError(`There is no file with id ${id}`);
    return file;
  });
}

/** A change to plan: tags to add and remove, on the files of a query or on files by id. */
interface ChangeRequest {
  query?: FileQuery;
  file_ids?: number[];
  add?: Tag[];
  remove?: Tag[];
  title: string;
}

/** Plans a change to the files of a query, or to files by id. */
export function proposeChanges(db: Db, input: ChangeRequest, source: PlanSource): Plan {
  const { query, file_ids, title, remove = [] } = input;
  const add = validTags(input.add ?? []); // `writeTags` has the last word
  if (add.length === 0 && remove.length === 0) throw new UserError('Nothing to add or remove');
  const givesExactlyOneScope = (query === undefined) !== (file_ids === undefined);
  if (!givesExactlyOneScope) throw new UserError('Give either a query or file_ids');
  const files = query ? db.searchFiles(query).files : filesById(db, file_ids ?? []);
  // Each op names only the tags that would change, so the plan's summary counts real changes.
  const ops = files.map(({ id, tags }) => ({
    file_id: id,
    add: add.filter((tag) => !tags.includes(tag)),
    remove: remove.filter((tag) => tags.includes(tag)),
  }));
  return proposePlan(db, title, source, ops);
}

/** Plans a rename on every file that has the tag. `from` is unchecked, so a bad one can be fixed. */
export function proposeRename(db: Db, from: Tag, to: Tag, source: PlanSource): Plan {
  const [newTag = ''] = validTags([to]);
  if (!newTag) throw new UserError('The new tag is empty');
  const ops = db.filesWithTag(from).map((file_id) => ({ file_id, add: [newTag], remove: [from] }));
  return proposePlan(db, `rename ${from} to ${newTag}`, source, ops);
}

/** Plans the accepted review items. A person vouched for them, so they are not marked as AI. */
export function proposeReviews(db: Db, items: ReviewItem[], source: PlanSource): Plan {
  const tagsByFile = new Map<number, Tag[]>();
  for (const { file_id, tag } of items) {
    const tags = tagsByFile.get(file_id) ?? [];
    tagsByFile.set(file_id, [...tags, tag]);
  }
  const ops = [...tagsByFile].map(([file_id, add]) => ({ file_id, add, remove: [] }));
  return proposePlan(db, `Accept ${items.length} review items`, source, ops);
}

/** Why each failed op failed, by file id. */
type OpErrors = Record<number, string>;

/** Why an op did not run, or undefined when it did. A failure stays with its own file. */
async function opFailure(
  op: TagOp,
  job: JobRun,
  runOp: (op: TagOp) => Promise<void>,
): Promise<string | undefined> {
  if (job.signal.aborted) return 'Cancelled';
  try {
    await runOp(op);
    return undefined;
  } catch (error) {
    return errorMessage(error);
  }
}

/** Runs ops one by one. A failed op is recorded, and the rest continue. */
async function runOps(
  ops: TagOp[],
  job: JobRun,
  runOp: (op: TagOp) => Promise<void>,
  afterEachBatch?: () => void,
): Promise<OpErrors> {
  const errors: OpErrors = {};
  let done = 0;
  for (const op of ops) {
    const failure = await opFailure(op, job, runOp);
    if (failure !== undefined) errors[op.file_id] = failure;
    done++;
    job.update({ done });
    const batchIsDone = done % YIELD_EVERY === 0;
    if (!batchIsDone) continue;
    afterEachBatch?.();
    await yieldToLoop();
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
  const crashHint =
    plan.status === 'applying' ? '. If that run crashed, try again in two minutes' : '';
  throw new UserError(`Plan ${id} is ${plan.status}${crashHint}`);
}

/** A plan after an apply: `ops` hold what really changed, and only a run with none of them failed. */
function appliedPlan(plan: Plan, ops: TagOp[], errors: OpErrors): Plan {
  const anyFailed = Object.keys(errors).length > 0;
  const nothingApplied = ops.length === 0;
  return {
    ...plan,
    status: anyFailed && nothingApplied ? 'failed' : 'applied',
    ops,
    summary: summarizeOps(ops),
    ...(anyFailed && { errors }),
  };
}

/**
 * Applies a claimed plan, merging into a fresh read of each file. The stored ops become what really
 * changed, so undo reverses only that. Cancelling leaves what ran applied and undoable. Each write
 * is recorded as it happens, so a crash loses no undo: the next apply picks up from those records.
 */
export async function applyPlan(db: Db, plan: Plan, rules: ApplyRules, job: JobRun): Promise<Plan> {
  // Starts with what an earlier run that died part-way recorded, and grows with each write.
  const recordedOps = db.planOps(plan.id);
  const recordedFiles = new Set(recordedOps.map((op) => op.file_id));
  const pendingOps = plan.ops.filter((op) => !recordedFiles.has(op.file_id));
  const applyAndRecord = async (op: TagOp) => {
    const changed = await applyOp(db, op, plan, rules);
    if (!hasTagChanges(changed)) return;
    db.addPlanOp(plan.id, changed);
    recordedOps.push(changed);
  };
  const keepClaim = () => db.touchPlan(plan.id, Date.now());
  const errors = await runOps(pendingOps, job, applyAndRecord, keepClaim);

  const cancelledBeforeAnyChange = job.signal.aborted && recordedOps.length === 0;
  if (cancelledBeforeAnyChange) {
    const proposed: Plan = { ...plan, status: 'proposed' }; // nothing ran, so it can still run
    db.savePlan(proposed);
    return proposed;
  }
  const applied = appliedPlan(plan, recordedOps, errors);
  // One transaction follows the renames and stores the plan, so they follow exactly once.
  return db.transaction(() => {
    const finished = withRenamesFollowed(db, applied, rules.facets);
    db.savePlan(finished);
    db.clearPlanOps(plan.id);
    return finished;
  });
}

/**
 * Reverses an applied plan with the same merge. A tag someone added since stays. An op whose tags
 * have all gone was overtaken, so what it removed is not put back on top of a later decision. A
 * plan with ops left, cancelled or failed, stays `applied` and holds only those, so undo can finish.
 */
export async function undoPlan(db: Db, plan: Plan, job: JobRun): Promise<Plan> {
  const errors = await runOps(plan.ops, job, (op) => undoOp(db, op, plan));
  const finished = undonePlan(plan, errors);
  db.transaction(() => {
    restoreFollowed(db, finished);
    db.savePlan(finished);
  });
  return finished;
}

/** A plan after an undo: `undone` when every op was reversed, or still `applied` with the rest. */
function undonePlan(plan: Plan, errors: OpErrors): Plan {
  const opsLeft = plan.ops.filter((op) => op.file_id in errors);
  if (opsLeft.length === 0) return { ...plan, status: 'undone', errors: undefined };
  return { ...plan, ops: opsLeft, summary: summarizeOps(opsLeft), errors };
}
