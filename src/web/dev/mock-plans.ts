/** The mock's plans, and what proposing and applying one does. */
import type { Plan, ToolMap } from '../../types.ts';
import { emit } from './mock-events.ts';
import { files, NOW, rnd } from './mock-files.ts';
import { search } from './mock-search.ts';

const MINUTE = 60_000;
const HOUR = 3_600_000;

type Sample = Pick<Plan, 'id' | 'title' | 'source' | 'status'> & {
  /** How long ago it was made, in milliseconds. */
  ago: number;
  added?: Record<string, number>;
  removed?: Record<string, number>;
};

function plan({ ago, added = {}, removed = {}, ...fields }: Sample): Plan {
  const count = Math.max(...Object.values({ ...added, ...removed }));
  return {
    ...fields,
    created_at: NOW - ago,
    ops: files
      .slice(0, count)
      .map((f) => ({ file_id: f.id, add: Object.keys(added), remove: Object.keys(removed) })),
    summary: { files: count, added, removed },
  };
}

/** Every plan, newest first. */
export const plans: Plan[] = [
  plan({
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
  plan({
    id: 'c04e11b8',
    title: 'Tag 2026 tax statements',
    source: 'mcp',
    status: 'proposed',
    ago: 47 * MINUTE,
    added: { 'topic:finance/tax': 61 },
  }),
  plan({
    id: 'a91d3e07',
    title: 'Rename doc-type:bill to doc-type:invoice',
    source: 'cleanup',
    status: 'applied',
    ago: 3 * HOUR,
    added: { 'doc-type:invoice': 88 },
    removed: { 'doc-type:bill': 88 },
  }),
  plan({
    id: '5be2707f',
    title: 'Organize ~/Pictures/Trips',
    source: 'organize',
    status: 'applied',
    ago: 26 * HOUR,
    added: { 'media:photo': 640, 'place:kyoto': 122, 'subject:street': 201 },
  }),
  plan({
    id: '19c0ffd2',
    title: 'Remove topic:misc from Archive',
    source: 'chat',
    status: 'undone',
    ago: 50 * HOUR,
    removed: { 'topic:misc': 37 },
  }),
  {
    ...plan({
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

/** Stands in for `propose_changes`, with the source a real caller would have. */
export function propose(
  input: ToolMap['propose_changes'][0],
  source: Plan['source'] = 'user',
): Plan {
  const targets =
    input.file_ids ?? search({ ...input.query, limit: 1e6, offset: 0 }).files.map((f) => f.id);
  const add = input.add ?? [];
  const remove = input.remove ?? [];
  const next: Plan = {
    id: Math.floor(rnd() * 2 ** 32)
      .toString(16)
      .padStart(8, '0'),
    title: input.title,
    source,
    status: 'proposed',
    created_at: Date.now(),
    ops: targets.map((file_id) => ({ file_id, add, remove })),
    summary: {
      files: targets.length,
      added: Object.fromEntries(add.map((t) => [t, targets.length])),
      removed: Object.fromEntries(remove.map((t) => [t, targets.length])),
    },
  };
  plans.unshift(next);
  return next;
}

/** Writes a plan's tags to the mock's files, or takes them back. */
export function write(target: Plan, reverse = false) {
  for (const op of target.ops) {
    const file = files[op.file_id - 1];
    if (!file) continue;
    const add = reverse ? op.remove : op.add;
    const remove = reverse ? op.add : op.remove;
    file.tags = [...new Set([...file.tags, ...add])].filter((t) => !remove.includes(t)).toSorted();
  }
  emit({ type: 'files', ids: target.ops.map((o) => o.file_id) });
}

/** A plan by id. */
export const find = (id: string) => {
  const found = plans.find((p) => p.id === id);
  if (!found) throw new Error(`No plan ${id}`);
  return found;
};
