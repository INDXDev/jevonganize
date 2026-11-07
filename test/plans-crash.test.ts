import { describe, expect, test, vi } from 'vitest';
import { claimPlan, type JobRun, recoverPlans, undoPlan } from '../src/core/plans.ts';
import { readTags } from '../src/core/tags.ts';
import {
  apply,
  applyWith,
  at,
  db,
  idOf,
  run,
  scanned,
  setupPlanLibrary,
  tagEverything,
} from './plans-helpers.ts';

setupPlanLibrary();

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

async function crashed() {
  await scanned('a.txt', 'b.txt');
  const { id } = tagEverything();
  const claimed = claimPlan(db, id);
  await expect(applyWith(claimed, crashing(1), 10)).rejects.toThrow('crash');
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
    await scanned('a.txt');
    const { id } = tagEverything();
    const controller = new AbortController();
    controller.abort();
    await apply(claimPlan(db, id), controller.signal);
    expect(db.getPlan(id)?.status).toBe('proposed');
  });
});
