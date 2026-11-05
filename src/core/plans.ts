/** Propose, apply, undo: every tag write in the app happens here. See docs/tags.md. */
import { randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { Facet, FileQuery, Job, Plan, ReviewItem, Tag, TagOp } from '../types.ts';
import { UserError } from './config.ts';
import type { Db, FileRecord } from './db.ts';
import { tagFacet } from './facets.ts';
import { recordRemoved, recordWrite } from './scan.ts';
import { FORBIDDEN, normalize, readTags, writeTags } from './tags.ts';

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

function checked(tags: Tag[]): Tag[] {
  const clean = normalize(tags);
  const bad = clean.find((tag) => FORBIDDEN.test(tag)); // `writeTags` has the last word
  if (bad !== undefined) {
    throw new UserError(`Tag ${JSON.stringify(bad)} has a character tags cannot contain`);
  }
  return clean;
}

function count(tags: Tag[], into: Record<Tag, number>): void {
  for (const tag of tags) into[tag] = (into[tag] ?? 0) + 1;
}

function summarize(ops: TagOp[]): Plan['summary'] {
  const summary: Plan['summary'] = { files: ops.length, added: {}, removed: {} };
  for (const op of ops) {
    count(op.add, summary.added);
    count(op.remove, summary.removed);
  }
  return summary;
}

/** Stores a plan. Ops that change nothing are dropped. No tag changes here. */
export function proposePlan(db: Db, title: string, source: Source, ops: TagOp[]): Plan {
  const kept = ops.filter((op) => op.add.length > 0 || op.remove.length > 0);
  const plan: Plan = {
    id: randomBytes(4).toString('hex'),
    title,
    source,
    status: 'proposed',
    created_at: Date.now(),
    ops: kept,
    summary: summarize(kept),
  };
  db.savePlan(plan);
  return plan;
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
  const add = checked(input.add ?? []);
  if (add.length === 0 && remove.length === 0) throw new UserError('Nothing to add or remove');
  if ((query === undefined) === (file_ids === undefined)) {
    throw new UserError('Give either a query or file_ids');
  }
  const files = query
    ? db.searchFiles(query).files
    : (file_ids ?? []).map((id) => {
        const file = db.fileRow(id);
        if (!file) throw new UserError(`There is no file with id ${id}`);
        return file;
      });
  const ops = files.map(({ id, tags }) => ({
    file_id: id,
    add: add.filter((tag) => !tags.includes(tag)),
    remove: remove.filter((tag) => tags.includes(tag)),
  }));
  return proposePlan(db, title, source, ops);
}

/** Plans a rename on every file that has the tag. `from` is unchecked, so a bad one can be fixed. */
export function proposeRename(db: Db, from: Tag, to: Tag, source: Source): Plan {
  const [target = ''] = checked([to]);
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

/** The merge from docs/tags.md. Returns what really changed. */
async function mergeWrite(
  db: Db,
  file: FileRecord,
  disk: Tag[],
  change: { add: Tag[]; remove: Tag[]; ai: boolean },
): Promise<{ add: Tag[]; remove: Tag[] }> {
  const merged = normalize([...disk, ...change.add].filter((tag) => !change.remove.includes(tag)));
  const add = merged.filter((tag) => !disk.includes(tag));
  const remove = disk.filter((tag) => !merged.includes(tag));
  const changed = add.length > 0 || remove.length > 0;
  if (changed) await writeTags(file.path, merged);
  const info = await lstat(file.path, { bigint: true });
  const now = { ino: String(info.ino), size: Number(info.size), mtime_ns: String(info.mtimeNs) };
  // The file was edited behind the index. A new fingerprint would hide that from the next scan.
  if (changed && contentStamp(now) === contentStamp(file)) await recordWrite(db, file.path);
  db.transaction(() => {
    db.addFileTags(file.id, add, change.ai);
    db.removeFileTags(file.id, remove);
    const { removed } = db.syncFileTags(file.id, merged);
    // The scan will not see these go, as the mirror has just caught up, so they are handled here.
    const missing = removed.filter(({ tag }) => !change.remove.includes(tag));
    recordRemoved(db, file.id, missing, now.ino !== file.ino);
  });
  return { add, remove };
}

/** Why an organize op no longer holds, or null. Other plans name their tags outright, so they merge. */
function conflict(
  op: TagOp,
  disk: Tag[],
  now: string,
  mirror: { ai: Tag[]; rejected: Tag[] },
  rules: { facets: Facet[]; maxTags: number },
) {
  if (op.stamp === undefined) return null;
  if (op.stamp !== now) return 'The file changed after this plan was made. Organize it again';
  const { ai, rejected } = mirror;
  const { facets, maxTags } = rules;
  const claimed = op.remove.find((tag) => disk.includes(tag) && !ai.includes(tag));
  if (claimed !== undefined) return `A person added ${claimed} after this plan was made`;
  const kept = disk.filter((tag) => !op.remove.includes(tag));
  const after = kept.length + op.add.filter((tag) => !kept.includes(tag)).length;
  if (after > maxTags && after > disk.length) return `This would pass max_tags, with ${after} tags`;
  for (const tag of op.add) {
    if (rejected.includes(tag)) return `A person rejected ${tag} after this plan was made`;
    const facet = facets.find(({ id }) => id === tagFacet(tag));
    if (!facet || facet.kind === 'flag' || facet.kind === 'multi') continue;
    const held = disk.find(
      (other) => other !== tag && tagFacet(other) === facet.id && !op.remove.includes(other),
    );
    if (held !== undefined) return `The file gained ${held} after this plan was made`;
  }
  return null;
}

async function applyOp(
  db: Db,
  op: TagOp,
  plan: Plan,
  rules: { facets: Facet[]; maxTags: number },
): Promise<TagOp> {
  const file = db.fileById(op.file_id);
  if (!file) throw new UserError('The file is no longer in the index');
  const info = await lstat(file.path, { bigint: true });
  if (!info.isFile()) throw new UserError(`${file.path} is not a regular file`);
  const disk = await readTags(file.path);
  const now = contentStamp({
    ino: String(info.ino),
    size: Number(info.size),
    mtime_ns: String(info.mtimeNs),
  });
  const wasAi = db
    .fileTags(file.id)
    .filter((row) => row.ai)
    .map((row) => row.tag);
  const mirror = { ai: wasAi, rejected: db.rejectedTags(file.id) };
  const reason = conflict(op, disk, now, mirror, rules);
  if (reason) throw new UserError(reason);
  const ai = plan.source === 'organize';
  const written = await mergeWrite(db, file, disk, { add: op.add, remove: op.remove, ai });
  if (!ai) {
    for (const tag of written.remove) {
      if (wasAi.includes(tag)) db.rejectTag(file.id, tag, 'Removed by a person');
    }
  }
  return { file_id: file.id, ...written };
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs ops one by one. A failed op is recorded, and the rest continue. */
async function runOps(
  todo: TagOp[],
  run: JobRun,
  work: (op: TagOp) => Promise<TagOp | null>,
  onBatch?: () => void,
): Promise<{ ops: TagOp[]; errors: Record<number, string> }> {
  const ops: TagOp[] = [];
  const errors: Record<number, string> = {};
  let done = 0;
  for (const op of todo) {
    if (run.signal.aborted) errors[op.file_id] = 'Cancelled';
    else {
      try {
        const result = await work(op);
        if (result) ops.push(result);
      } catch (error) {
        errors[op.file_id] = reasonOf(error);
      }
    }
    run.update({ done: ++done });
    if (done % YIELD_EVERY === 0) {
      onBatch?.();
      await yieldToLoop();
    }
  }
  return { ops, errors };
}

/** Gives back plans whose apply died. What they wrote stays in `plan_op`, for the next apply. */
export const recoverPlans = (db: Db) => db.releasePlans(Date.now() - CLAIM_STALE_MS);

/** Takes a plan for applying. Atomic, so two callers, even in two processes, cannot both run it. */
export function claimPlan(db: Db, id: string): Plan {
  recoverPlans(db);
  const claimed = db.claimPlan(id, Date.now());
  const plan = db.getPlan(id);
  if (!plan) throw new UserError(`There is no plan ${id}`);
  if (!claimed) {
    const hint =
      plan.status === 'applying' ? '. If that run crashed, try again in two minutes' : '';
    throw new UserError(`Plan ${id} is ${plan.status}${hint}`);
  }
  return plan;
}

/**
 * Applies a claimed plan, merging into a fresh read of each file. The stored ops become what really
 * changed, so undo reverses only that. Cancelling leaves what ran applied and undoable. Each write
 * is recorded as it happens, so a crash loses no undo: the next apply picks up from those records.
 */
export async function applyPlan(
  db: Db,
  plan: Plan,
  facets: Facet[],
  run: JobRun,
  maxTags: number,
): Promise<Plan> {
  const earlier = db.planOps(plan.id);
  const written = new Set(earlier.map((op) => op.file_id));
  const { ops: fresh, errors } = await runOps(
    plan.ops.filter((op) => !written.has(op.file_id)),
    run,
    async (op) => {
      const result = await applyOp(db, op, plan, { facets, maxTags });
      if (result.add.length === 0 && result.remove.length === 0) return null;
      db.addPlanOp(plan.id, result);
      return result;
    },
    () => db.touchPlan(plan.id, Date.now()),
  );
  const ops = [...earlier, ...fresh];
  const failed = Object.keys(errors).length;
  if (run.signal.aborted && ops.length === 0) {
    const proposed: Plan = { ...plan, status: 'proposed' }; // nothing ran, so it can still run
    db.savePlan(proposed);
    return proposed;
  }
  const applied: Plan = {
    ...plan,
    status: failed > 0 && ops.length === 0 ? 'failed' : 'applied',
    ops,
    summary: summarize(ops),
    ...(failed > 0 && { errors }),
  };
  db.transaction(() => {
    db.savePlan(applied);
    db.clearPlanOps(plan.id);
  });
  return applied;
}

/**
 * Reverses an applied plan with the same merge. A tag someone added since stays. An op whose tags
 * have all gone was overtaken, so what it removed is not put back on top of a later decision. A
 * plan with ops left, cancelled or failed, stays `applied` and holds only those, so undo can finish.
 */
export async function undoPlan(db: Db, plan: Plan, run: JobRun): Promise<Plan> {
  const { errors } = await runOps(plan.ops, run, async (op) => {
    const file = db.fileById(op.file_id);
    if (!file) throw new UserError('The file is no longer in the index');
    const disk = await readTags(file.path);
    if (op.add.length > 0 && op.remove.length > 0 && !op.add.some((tag) => disk.includes(tag))) {
      throw new UserError('The tags on this file changed after the plan ran');
    }
    const ai = plan.source === 'organize';
    const { add } = await mergeWrite(db, file, disk, { add: op.remove, remove: op.add, ai });
    for (const tag of add) db.unrejectTag(file.id, tag);
    return op;
  });
  const left = plan.ops.filter((op) => op.file_id in errors);
  const undone: Plan =
    left.length > 0
      ? { ...plan, ops: left, summary: summarize(left), errors }
      : { ...plan, status: 'undone', errors: undefined };
  db.savePlan(undone);
  return undone;
}
