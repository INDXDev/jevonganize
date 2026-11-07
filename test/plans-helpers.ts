/** Shared setup of the plan tests: a library in a temp home, and ways to plan and apply on it. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { type Db, openDb } from '../src/core/db.ts';
import { contentStamp } from '../src/core/plan-ops.ts';
import { applyPlan, type JobRun, proposeChanges, proposePlan } from '../src/core/plans.ts';
import { scanLibrary } from '../src/core/scan.ts';
import { writeTags } from '../src/core/tags.ts';
import type { Facet, Job, Plan, TagOp } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

/** The index of the running test. */
export let db: Db;
/** The library of the running test. */
export let root: string;

const config = configSchema.parse({});

const facets: Facet[] = [
  {
    id: 'doc-type',
    pack: 'p',
    title: 't',
    kind: 'choice',
    values: { a: 'A' },
    applies_to: [],
    weight: 1,
  },
  {
    id: 'topic',
    pack: 'p',
    title: 't',
    kind: 'multi',
    values: { a: 'A' },
    applies_to: [],
    weight: 1,
  },
];

/** Gives each test in the file a temp home, an index and an empty library. */
export function setupPlanLibrary(): void {
  const home = useTempHome();
  beforeEach(async () => {
    root = join(home(), 'library');
    await mkdir(root);
    db = openDb();
    db.addLibrary(root);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });
}

/** A path inside the library. */
export const at = (name: string) => join(root, name);

/** The index id of a file in the library. */
export const idOf = (name: string) => db.fileByPath(at(name))!.id;

/** Writes a file into the library, with tags if given. */
export async function put(name: string, tags: string[] = []) {
  await writeFile(at(name), name);
  if (tags.length > 0) await writeTags(at(name), tags);
}

/** Scans the library. */
export const scan = () => scanLibrary(db, config, root);

/** Writes untagged files into the library and scans them. */
export async function scanned(...names: string[]) {
  for (const name of names) await put(name);
  await scan();
}

/** Scans a.txt holding one tag, on record as AI's, and returns its id. */
export async function aiTagged(tag: string) {
  await put('a.txt', [tag]);
  await scan();
  const id = idOf('a.txt');
  db.addFileTags(id, [tag], true);
  return id;
}

/** A job run that collects its patches. */
export function run(patches: Partial<Job>[] = [], signal = new AbortController().signal): JobRun {
  return { signal, update: (patch) => void patches.push(patch) };
}

/** Applies a plan under the given run. */
export const applyWith = (plan: Plan, job: JobRun, maxTags = config.max_tags) =>
  applyPlan(db, plan, { facets, maxTags }, job);

/** Applies a plan under a plain run. */
export const apply = (plan: Plan, signal?: AbortSignal, maxTags?: number) =>
  applyWith(plan, run([], signal), maxTags);

/** A person's plan to add the tag `x` to everything in the library. */
export const tagEverything = () =>
  proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user');

/** A person's plan for one file. */
export const changeFile = (name: string, change: { add?: string[]; remove?: string[] }) =>
  proposeChanges(db, { file_ids: [idOf(name)], ...change, title: 't' }, 'user');

/** An organize plan for one file, stamped as `organize.ts` stamps it. */
export function organizeOp(name: string, add: string[], remove: string[] = []): TagOp {
  const row = db.fileByPath(at(name))!;
  return { file_id: row.id, add, remove, stamp: contentStamp(row) };
}

/** An organize plan of the given ops. */
export const organizePlan = (ops: TagOp[]) => proposePlan(db, 'o', 'organize', ops);
