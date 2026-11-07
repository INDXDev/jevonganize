/** The mock's plans, and what proposing and applying one does. */
import type { Plan } from '../../types.ts';
import type { ToolMap } from '../../tool-map.ts';
import { emit } from './mock-events.ts';
import { runJob } from './mock-jobs.ts';
import { files, NOW, rnd } from './mock-files.ts';
import { searchFiles } from './mock-search.ts';

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A sample plan in short: tag counts stand for its ops, which are made from them. */
type PlanSample = Pick<Plan, 'id' | 'title' | 'source' | 'status'> & {
  /** How long ago it was made, in milliseconds. */
  ago: number;
  /** Each tag the plan adds, with how many files get it. */
  added?: Record<string, number>;
  removed?: Record<string, number>;
};

/** A plan over the first files of the library, as many as its most used tag needs. */
function samplePlan({ ago, added = {}, removed = {}, ...fields }: PlanSample): Plan {
  const fileCount = Math.max(...Object.values({ ...added, ...removed }));
  const ops = files.slice(0, fileCount).map((file) => ({
    file_id: file.id,
    add: Object.keys(added),
    remove: Object.keys(removed),
  }));
  return {
    ...fields,
    created_at: NOW - ago,
    ops,
    summary: { files: fileCount, added, removed },
  };
}

/** Every plan, newest first. */
export const plans: Plan[] = [
  samplePlan({
    id: '7f3a9c21',
    title: 'Organize ~/Downloads',
    source: 'organize',
    status: 'proposed',
    ago: 12 * MINUTE,
    added: {
      'doc-type:invoice': 214,
      'topic:finance': 187,
      'doc-date:2026': 312,
      'media:screenshot': 64,
      'vendor:northwind': 41,
    },
  }),
  samplePlan({
    id: 'c04e11b8',
    title: 'Tag 2026 tax statements',
    source: 'mcp',
    status: 'proposed',
    ago: 47 * MINUTE,
    added: { 'topic:finance/tax': 61 },
  }),
  samplePlan({
    id: 'a91d3e07',
    title: 'Rename doc-type:bill to doc-type:invoice',
    source: 'cleanup',
    status: 'applied',
    ago: 3 * HOUR,
    added: { 'doc-type:invoice': 88 },
    removed: { 'doc-type:bill': 88 },
  }),
  samplePlan({
    id: '5be2707f',
    title: 'Organize ~/Pictures/Trips',
    source: 'organize',
    status: 'applied',
    ago: 26 * HOUR,
    added: { 'media:photo': 640, 'place:kyoto': 122, 'subject:street': 201 },
  }),
  samplePlan({
    id: '19c0ffd2',
    title: 'Remove topic:misc from Archive',
    source: 'chat',
    status: 'undone',
    ago: 50 * HOUR,
    removed: { 'topic:misc': 37 },
  }),
  {
    ...samplePlan({
      id: 'e3307ab1',
      title: 'Organize ~/Documents/Scans',
      source: 'organize',
      status: 'failed',
      ago: 72 * HOUR,
      added: { 'doc-type:receipt': 9 },
    }),
    errors: { 12: 'Volume is read only', 40: 'File changed during apply' },
  },
];

/** A random eight-digit hex id, as the server makes. */
const planId = () =>
  Math.floor(rnd() * 2 ** 32)
    .toString(16)
    .padStart(8, '0');

/** Stands in for `propose_changes`, with the source a real caller would have. */
export function propose(
  input: ToolMap['propose_changes'][0],
  source: Plan['source'] = 'user',
): Plan {
  const fileIds =
    input.file_ids ?? searchFiles({ ...input.query, limit: 1e6, offset: 0 }).files.map((f) => f.id);
  const add = input.add ?? [];
  const remove = input.remove ?? [];
  const everyFile = (tags: string[]) =>
    Object.fromEntries(tags.map((tag) => [tag, fileIds.length]));
  const plan: Plan = {
    id: planId(),
    title: input.title,
    source,
    status: 'proposed',
    created_at: Date.now(),
    ops: fileIds.map((file_id) => ({ file_id, add, remove })),
    summary: { files: fileIds.length, added: everyFile(add), removed: everyFile(remove) },
  };
  plans.unshift(plan);
  return plan;
}

/** Writes a plan's tags to the mock's files, or takes them back when `undo` is set. */
function writePlan(plan: Plan, undo = false) {
  for (const op of plan.ops) {
    const file = files[op.file_id - 1];
    if (!file) continue;
    const add = undo ? op.remove : op.add;
    const remove = undo ? op.add : op.remove;
    const merged = [...new Set([...file.tags, ...add])];
    file.tags = merged.filter((tag) => !remove.includes(tag)).toSorted();
  }
  emit({ type: 'files', ids: plan.ops.map((op) => op.file_id) });
}

/** A plan by id. Throws, as the server does, for one that does not exist. */
export function findPlan(id: string) {
  const found = plans.find((plan) => plan.id === id);
  if (!found) throw new Error(`No plan ${id}`);
  return found;
}

/** A job that writes a plan's tags as it ends, or takes them back for an undo. */
function writeJob(kind: 'apply' | 'undo', plan: Plan) {
  const undo = kind === 'undo';
  return runJob(kind, Math.max(plan.summary.files, 1), () => (writePlan(plan, undo), {}));
}

/** Stands in for `apply_plan`. Only a proposed plan can be applied. */
export function applyPlan({ id }: { id: string }) {
  const plan = findPlan(id);
  if (plan.status !== 'proposed') throw new Error('This plan is not proposed');
  plan.status = 'applied';
  return writeJob('apply', plan);
}

/** Stands in for `undo_plan`. */
export function undoPlan({ id }: { id: string }) {
  const plan = findPlan(id);
  plan.status = 'undone';
  return writeJob('undo', plan);
}

/** Stands in for `rename_tag`: a clean-up plan that swaps one tag for another. */
export const renameTag = ({ from, to }: ToolMap['rename_tag'][0]) =>
  propose(
    { query: { tags: [from] }, add: [to], remove: [from], title: `Rename ${from} to ${to}` },
    'cleanup',
  );

/** Stands in for `discard_plan`. */
export function discardPlan({ id }: { id: string }) {
  plans.splice(plans.indexOf(findPlan(id)), 1);
}

/** Stands in for `list_plans`: summaries only, so the ops are left out. */
export const listPlans = ({ status }: ToolMap['list_plans'][0]) =>
  plans.filter((plan) => !status || plan.status === status).map((plan) => ({ ...plan, ops: [] }));
