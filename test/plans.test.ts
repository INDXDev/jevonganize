import { execFileSync } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import bplist from 'bplist-creator';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { type Db, openDb } from '../src/core/db.ts';
import type { Facet, Job, Plan, TagOp } from '../src/types.ts';
import {
  applyPlan,
  claimPlan,
  contentStamp,
  type JobRun,
  proposeChanges,
  proposePlan,
  proposeRename,
  proposeReviews,
  recoverPlans,
  undoPlan,
} from '../src/core/plans.ts';
import { scanLibrary } from '../src/core/scan.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { useTempHome } from './helpers.ts';

const home = useTempHome();
let db: Db;
let root: string;
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

const at = (name: string) => join(root, name);
const idOf = (name: string) => db.fileByPath(at(name))!.id;

async function put(name: string, tags: string[] = []) {
  await writeFile(at(name), name);
  if (tags.length > 0) await writeTags(at(name), tags);
}

const scan = () => scanLibrary(db, config, root);

function run(patches: Partial<Job>[] = [], signal = new AbortController().signal): JobRun {
  return { signal, update: (patch) => void patches.push(patch) };
}

const apply = (plan: Plan, signal?: AbortSignal, maxTags = config.max_tags) =>
  applyPlan(db, plan, facets, run([], signal), maxTags);

/** A run that dies after `ops` ops, as a killed process does: nothing after it is saved. */
function crashing(ops: number): JobRun {
  let done = 0;
  return {
    signal: new AbortController().signal,
    update: () => {
      if (++done >= ops) throw new Error('crash');
    },
  };
}

/** Moves the clock past the point where a claim counts as abandoned. */
function afterTheCrash() {
  const later = Date.now() + 3_600_000;
  vi.spyOn(Date, 'now').mockReturnValue(later);
}

/** An organize plan for one file, stamped as `organize.ts` stamps it. */
function organizeOp(name: string, add: string[], remove: string[] = []): TagOp {
  const row = db.fileByPath(at(name))!;
  return { file_id: row.id, add, remove, stamp: contentStamp(row) };
}

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

const organizePlan = (ops: TagOp[]) => proposePlan(db, 'o', 'organize', ops);

describe('propose', () => {
  test('stores a plan with a summary, drops no-ops, and changes nothing', async () => {
    await put('a.txt', ['keep']);
    await put('b.txt');
    await scan();
    const plan = proposeChanges(
      db,
      { query: { folder: root }, add: ['keep'], title: 'tag' },
      'user',
    );
    expect(plan.ops).toEqual([{ file_id: idOf('b.txt'), add: ['keep'], remove: [] }]);
    expect(plan.summary).toEqual({ files: 1, added: { keep: 1 }, removed: {} });
    expect(db.getPlan(plan.id)).toEqual(plan);
    expect(await readTags(at('b.txt'))).toEqual([]);
  });

  test('refuses bad tags, unknown ids, an empty change and an unclear scope', async () => {
    await put('a.txt');
    await scan();
    const file_ids = [idOf('a.txt')];
    expect(() => proposeChanges(db, { file_ids, add: ['a,b'], title: 't' }, 'user')).toThrow(
      'cannot contain',
    );
    expect(() => proposeChanges(db, { file_ids: [999], add: ['x'], title: 't' }, 'user')).toThrow(
      'no file',
    );
    expect(() => proposeChanges(db, { file_ids, title: 't' }, 'user')).toThrow('Nothing');
    expect(() => proposeChanges(db, { add: ['x'], title: 't' }, 'user')).toThrow('either');
  });

  test('a rename cannot make a bad tag', () => {
    expect(() => proposeRename(db, 'x', 'c,d', 'user')).toThrow('cannot contain');
  });
});

describe('apply', () => {
  test('merges into a fresh read, so a tag set elsewhere survives', async () => {
    await put('a.txt', ['old']);
    await scan();
    const plan = proposeChanges(
      db,
      { file_ids: [idOf('a.txt')], add: ['new'], remove: ['old'], title: 't' },
      'user',
    );
    await writeTags(at('a.txt'), ['old', 'elsewhere']);
    const applied = await apply(plan);
    expect(await readTags(at('a.txt'))).toEqual(['elsewhere', 'new']);
    expect(db.fileTags(idOf('a.txt')).map((row) => row.tag)).toEqual(['elsewhere', 'new']);
    expect(applied.ops).toEqual([{ file_id: idOf('a.txt'), add: ['new'], remove: ['old'] }]);
  });

  test('stores what really changed, so undo reverses only that', async () => {
    await put('a.txt');
    await scan();
    const plan = proposeChanges(
      db,
      { file_ids: [idOf('a.txt')], add: ['x', 'y'], title: 't' },
      'user',
    );
    await writeTags(at('a.txt'), ['x']); // a person got there first
    const applied = await apply(plan);
    expect(applied.ops[0]?.add).toEqual(['y']);
    expect(applied.summary.added).toEqual({ y: 1 });
    await undoPlan(db, applied, run());
    expect(await readTags(at('a.txt'))).toEqual(['x']);
  });

  test('the next scan sees nothing to do, because the fingerprint was stored', async () => {
    await put('a.txt');
    await scan();
    const plan = proposeChanges(db, { file_ids: [idOf('a.txt')], add: ['x'], title: 't' }, 'user');
    await apply(plan);
    expect(await scan()).toMatchObject({ changed: 0, added: 0 });
  });

  test('an edit behind the index stays visible to the next scan', async () => {
    await put('a.txt');
    await scan();
    const plan = proposeChanges(db, { file_ids: [idOf('a.txt')], add: ['x'], title: 't' }, 'user');
    await writeFile(at('a.txt'), 'edited, and longer than before');
    await apply(plan);
    expect((await scan()).changed).toBe(1);
    expect(db.fileByPath(at('a.txt'))?.status).toBe('new');
  });

  test('records provenance: organize is AI, a person’s plan and an accepted review are not', async () => {
    await put('a.txt');
    await put('b.txt');
    await scan();
    await apply(proposePlan(db, 'o', 'organize', [organizeOp('a.txt', ['doc-type:a'])]));
    expect(db.fileTags(idOf('a.txt'))).toEqual([{ tag: 'doc-type:a', ai: true }]);

    const id = idOf('b.txt');
    db.addReview({ file_id: id, kind: 'suggest', tag: 'topic:a', confidence: 0.6, reason: 'r' });
    await apply(proposeReviews(db, db.listReviews(), 'user'));
    expect(db.fileTags(id)).toEqual([{ tag: 'topic:a', ai: false }]);
  });

  test('a person removing an AI tag leaves a tombstone, and undoing organize does not', async () => {
    await put('a.txt');
    await scan();
    const id = idOf('a.txt');
    const organized = await apply(
      proposePlan(db, 'o', 'organize', [organizeOp('a.txt', ['topic:a'])]),
    );
    await undoPlan(db, organized, run());
    expect(db.rejectedTags(id)).toEqual([]);

    await apply(proposePlan(db, 'o', 'organize', [organizeOp('a.txt', ['topic:a'])]));
    await apply(proposeChanges(db, { file_ids: [id], remove: ['topic:a'], title: 't' }, 'user'));
    expect(db.rejectedTags(id)).toEqual(['topic:a']);
  });

  test('a failed op is recorded, and the rest continue', async () => {
    await put('a.txt');
    await put('b.txt');
    await scan();
    const plan = proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user');
    await rm(at('a.txt'));
    const applied = await apply(plan);
    expect(applied.status).toBe('applied');
    expect(Object.keys(applied.errors ?? {})).toEqual([String(idOf('a.txt'))]);
    expect(await readTags(at('b.txt'))).toEqual(['x']);
  });

  test('a plan with every op failed is failed, and a moved file names itself', async () => {
    await put('a.txt');
    await scan();
    const plan = proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user');
    await rename(at('a.txt'), at('b.txt'));
    expect(await apply(plan)).toMatchObject({ status: 'failed', ops: [] });
  });

  test.runIf(process.platform === 'darwin')(
    'a foreign bad tag blocks the write, and a rename then fixes it',
    async () => {
      await put('a.txt');
      const hex = bplist(['a,b\n0']).toString('hex');
      execFileSync('xattr', ['-wx', 'com.apple.metadata:_kMDItemUserTags', hex, at('a.txt')]);
      await scan();
      const file_ids = [idOf('a.txt')];
      const blocked = await apply(proposeChanges(db, { file_ids, add: ['x'], title: 't' }, 'user'));
      expect(blocked.errors?.[idOf('a.txt')]).toContain('cannot contain');
      expect(await readTags(at('a.txt'))).toEqual(['a,b']);
      expect(await apply(proposeRename(db, 'a,b', 'ab', 'user'))).toMatchObject({
        status: 'applied',
      });
      expect(await readTags(at('a.txt'))).toEqual(['ab']);
    },
  );

  test('cancelling stops between ops, and nothing done means it can still run', async () => {
    await put('a.txt');
    await scan();
    const plan = proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user');
    const controller = new AbortController();
    controller.abort();
    expect(await apply(plan, controller.signal)).toMatchObject({ status: 'proposed' });
    expect(await readTags(at('a.txt'))).toEqual([]);
  });

  test('reports progress per op', async () => {
    await put('a.txt');
    await scan();
    const patches: Partial<Job>[] = [];
    const plan = proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user');
    await applyPlan(db, plan, facets, run(patches), config.max_tags);
    expect(patches).toContainEqual({ done: 1 });
  });
});

async function crashed() {
  await put('a.txt');
  await put('b.txt');
  await scan();
  const { id } = proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user');
  const claimed = claimPlan(db, id);
  await expect(applyPlan(db, claimed, facets, crashing(1), 10)).rejects.toThrow('crash');
  expect(await readTags(at('a.txt'))).toEqual(['x']);
  return id;
}

describe('a crash while applying', () => {
  test('a running claim refuses a second one', async () => {
    const id = await crashed();
    recoverPlans(db);
    expect(() => claimPlan(db, id)).toThrow('applying');
  });

  test('an abandoned claim comes back, and re-applying keeps undo for both runs', async () => {
    const id = await crashed();
    afterTheCrash();
    recoverPlans(db);
    expect(db.getPlan(id)?.status).toBe('proposed');
    const applied = await apply(claimPlan(db, id));
    expect(applied.ops.map((op) => op.file_id)).toEqual([idOf('a.txt'), idOf('b.txt')]);
    expect(applied.summary.added).toEqual({ x: 2 });
    expect(db.planOps(id)).toEqual([]);
    await undoPlan(db, applied, run());
    expect(await readTags(at('a.txt'))).toEqual([]);
    expect(await readTags(at('b.txt'))).toEqual([]);
  });

  test('what a dead run wrote is on record until the plan finishes', async () => {
    const id = await crashed();
    expect(db.planOps(id)).toEqual([{ file_id: idOf('a.txt'), add: ['x'], remove: [] }]);
  });

  test('a cancelled claim with nothing done goes back to proposed', async () => {
    await put('a.txt');
    await scan();
    const { id } = proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user');
    const controller = new AbortController();
    controller.abort();
    await apply(claimPlan(db, id), controller.signal);
    expect(db.getPlan(id)?.status).toBe('proposed');
  });
});

describe('conflicts since an organize plan was made', () => {
  test('refuses to remove a tag a person added back', async () => {
    await put('a.txt', ['doc-type:b']);
    await scan();
    const id = idOf('a.txt');
    db.addFileTags(id, ['doc-type:b'], true);
    const plan = organizePlan([organizeOp('a.txt', ['doc-type:a'], ['doc-type:b'])]);
    await writeTags(at('a.txt'), []);
    await scan();
    await writeTags(at('a.txt'), ['doc-type:b']);
    await scan();
    const applied = await apply(plan);
    expect(applied.errors?.[id]).toContain('doc-type:b');
    expect(await readTags(at('a.txt'))).toEqual(['doc-type:b']);
  });

  test('refuses an op that would pass max_tags, and adds nothing', async () => {
    await put('a.txt');
    await scan();
    const plan = organizePlan([organizeOp('a.txt', ['topic:a'])]);
    await writeTags(at('a.txt'), ['one', 'two']);
    const applied = await apply(plan, undefined, 2);
    expect(applied.errors?.[idOf('a.txt')]).toContain('max_tags');
    expect(await readTags(at('a.txt'))).toEqual(['one', 'two']);
  });

  test('refuses a file whose content changed', async () => {
    await put('a.txt');
    await scan();
    const plan = organizePlan([organizeOp('a.txt', ['doc-type:a'])]);
    await writeFile(at('a.txt'), 'a different document');
    const applied = await apply(plan);
    expect(applied.errors?.[idOf('a.txt')]).toContain('changed after this plan');
    expect(await readTags(at('a.txt'))).toEqual([]);
  });

  test('refuses when a person set a single-valued facet meanwhile', async () => {
    await put('a.txt');
    await scan();
    const plan = organizePlan([organizeOp('a.txt', ['doc-type:a', 'topic:a'])]);
    await writeTags(at('a.txt'), ['doc-type:b']);
    const applied = await apply(plan);
    expect(applied.errors?.[idOf('a.txt')]).toContain('doc-type:b');
    expect(await readTags(at('a.txt'))).toEqual(['doc-type:b']);
  });

  test('a multi facet does not conflict, and neither does a replaced tag', async () => {
    await put('a.txt', ['doc-type:b', 'topic:b']);
    await scan();
    db.addFileTags(idOf('a.txt'), ['doc-type:b'], true); // organize only ever replaces its own
    const op = organizeOp('a.txt', ['doc-type:a', 'topic:a'], ['doc-type:b']);
    await apply(organizePlan([op]));
    expect(await readTags(at('a.txt'))).toEqual(['doc-type:a', 'topic:a', 'topic:b']);
  });

  test('refuses a tag a person rejected meanwhile', async () => {
    await put('a.txt');
    await scan();
    const plan = organizePlan([organizeOp('a.txt', ['topic:a'])]);
    db.rejectTag(idOf('a.txt'), 'topic:a', 'no');
    expect((await apply(plan)).errors?.[idOf('a.txt')]).toContain('rejected');
  });

  test('a person’s plan names its tags outright, so it merges', async () => {
    await put('a.txt');
    await scan();
    const plan = proposeChanges(
      db,
      { file_ids: [idOf('a.txt')], add: ['doc-type:a'], title: 't' },
      'user',
    );
    await writeTags(at('a.txt'), ['doc-type:b']);
    expect((await apply(plan)).errors).toBeUndefined();
  });
});

describe('tags that went missing before a plan ran', () => {
  test('an AI tag a person removed gets a tombstone, though the write hides it from the scan', async () => {
    await put('a.txt', ['topic:a']);
    await scan();
    const id = idOf('a.txt');
    db.addFileTags(id, ['topic:a'], true);
    await writeTags(at('a.txt'), []);
    await apply(proposeChanges(db, { file_ids: [id], add: ['x'], title: 't' }, 'user'));
    await scan();
    expect(db.rejectedTags(id)).toEqual(['topic:a']);
  });

  test('a tag the op itself removes gets none', async () => {
    await put('a.txt', ['topic:a']);
    await scan();
    const id = idOf('a.txt');
    db.addFileTags(id, ['topic:a'], true);
    await apply(organizePlan([organizeOp('a.txt', ['topic:b'], ['topic:a'])]));
    expect(db.rejectedTags(id)).toEqual([]);
  });

  test('a file replaced by a save raises a restore item, not a tombstone', async () => {
    await put('a.txt', ['topic:a']);
    await scan();
    const id = idOf('a.txt');
    db.addFileTags(id, ['topic:a'], true);
    await writeFile(at('a.new'), 'saved');
    await rename(at('a.new'), at('a.txt'));
    await apply(proposeChanges(db, { file_ids: [id], add: ['x'], title: 't' }, 'user'));
    expect(db.rejectedTags(id)).toEqual([]);
    expect(db.reviewsForFile(id).map(({ kind, tag }) => [kind, tag])).toEqual([
      ['restore', 'topic:a'],
    ]);
  });
});

describe('undo', () => {
  test('a cancelled undo stays applied, keeps only what is left, and can finish', async () => {
    await put('a.txt');
    await put('b.txt');
    await scan();
    const applied = await apply(
      proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user'),
    );
    const controller = new AbortController();
    const cancelling = { signal: controller.signal, update: () => controller.abort() };
    const part = await undoPlan(db, applied, cancelling);
    expect(part).toMatchObject({ status: 'applied', summary: { files: 1, added: { x: 1 } } });
    expect(part.ops.map((op) => op.file_id)).toEqual([idOf('b.txt')]);
    expect(db.getPlan(applied.id)).toEqual(part);
    expect(await readTags(at('a.txt'))).toEqual([]);
    expect(await readTags(at('b.txt'))).toEqual(['x']);
    const rest = await undoPlan(db, part, run());
    expect(rest.status).toBe('undone');
    expect(rest.errors).toBeUndefined();
    expect(await readTags(at('b.txt'))).toEqual([]);
  });

  test('restores an AI tag as AI, so a later answer can still replace it', async () => {
    await put('a.txt', ['doc-type:b']);
    await scan();
    const id = idOf('a.txt');
    db.addFileTags(id, ['doc-type:b'], true);
    const applied = await apply(
      organizePlan([organizeOp('a.txt', ['doc-type:a'], ['doc-type:b'])]),
    );
    await undoPlan(db, applied, run());
    expect(db.fileTags(id)).toEqual([{ tag: 'doc-type:b', ai: true }]);
  });

  test('undoing a person’s removal clears its tombstone', async () => {
    await put('a.txt', ['topic:a']);
    await scan();
    const id = idOf('a.txt');
    db.addFileTags(id, ['topic:a'], true);
    const applied = await apply(
      proposeChanges(db, { file_ids: [id], remove: ['topic:a'], title: 't' }, 'user'),
    );
    expect(db.rejectedTags(id)).toEqual(['topic:a']);
    await undoPlan(db, applied, run());
    expect(db.rejectedTags(id)).toEqual([]);
    expect(await readTags(at('a.txt'))).toEqual(['topic:a']);
  });

  test('a tag added after the plan ran stays', async () => {
    await put('a.txt');
    await scan();
    const applied = await apply(
      proposeChanges(db, { file_ids: [idOf('a.txt')], add: ['x'], title: 't' }, 'user'),
    );
    await writeTags(at('a.txt'), ['later', 'x']);
    expect(await undoPlan(db, applied, run())).toMatchObject({ status: 'undone' });
    expect(await readTags(at('a.txt'))).toEqual(['later']);
  });

  test('restores what the plan removed', async () => {
    await put('a.txt', ['old']);
    await scan();
    const applied = await apply(proposeRename(db, 'old', 'new', 'user'));
    await undoPlan(db, applied, run());
    expect(await readTags(at('a.txt'))).toEqual(['old']);
    expect(db.fileTags(idOf('a.txt'))).toEqual([{ tag: 'old', ai: false }]);
  });

  test('a rename overtaken by a person is not put back', async () => {
    await put('a.txt', ['old']);
    await scan();
    const applied = await apply(proposeRename(db, 'old', 'new', 'user'));
    await writeTags(at('a.txt'), ['other']);
    const undone = await undoPlan(db, applied, run());
    expect(undone.status).toBe('applied');
    expect(undone.errors?.[idOf('a.txt')]).toContain('changed after');
    expect(await readTags(at('a.txt'))).toEqual(['other']);
  });

  test('a tag someone already removed is no failure', async () => {
    await put('a.txt');
    await scan();
    const applied = await apply(
      proposeChanges(db, { file_ids: [idOf('a.txt')], add: ['x'], title: 't' }, 'user'),
    );
    await writeTags(at('a.txt'), []);
    expect(await undoPlan(db, applied, run())).toMatchObject({ status: 'undone' });
  });

  test('a missing file fails that op and stays to undo, and the rest are undone', async () => {
    await put('a.txt');
    await put('b.txt');
    await scan();
    const applied = await apply(
      proposeChanges(db, { query: { folder: root }, add: ['x'], title: 't' }, 'user'),
    );
    const id = idOf('a.txt');
    await rm(at('a.txt'));
    const undone = await undoPlan(db, applied, run());
    expect(undone.status).toBe('applied');
    expect(undone.ops.map((op) => op.file_id)).toEqual([id]);
    expect(Object.keys(undone.errors ?? {})).toEqual([String(id)]);
    expect(await readTags(at('b.txt'))).toEqual([]);
  });
});
