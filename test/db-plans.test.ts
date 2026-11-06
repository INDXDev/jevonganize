import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { db, home, plan, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

describe('plan claims', () => {
  it('only one of two connections gets a plan', () => {
    const file = join(home(), 'index.db');
    const one = openDb(file);
    const two = openDb(file);
    one.savePlan(plan('p', 1));
    expect(one.claimPlan('p', 1000)).toBe(true);
    expect(two.claimPlan('p', 1000)).toBe(false);
    expect(two.getPlan('p')?.status).toBe('applying');
    one.close();
    two.close();
  });

  it('gives back only claims older than the limit', () => {
    db.savePlan(plan('old', 1));
    db.savePlan(plan('new', 2));
    db.claimPlan('old', 1000);
    db.claimPlan('new', 5000);
    db.releasePlans(2000);
    expect(db.getPlan('old')?.status).toBe('proposed');
    expect(db.listPlans('applying').map(({ id }) => id)).toEqual(['new']);
  });
});

describe('plans', () => {
  it('round-trips a plan, and replaces it by id', () => {
    db.savePlan(plan('p', 1));
    expect(db.getPlan('p')).toEqual(plan('p', 1));
    db.savePlan(plan('p', 1, 'applied'));
    expect(db.getPlan('p')?.status).toBe('applied');
    expect(db.listPlans('proposed')).toEqual([]);
    expect(db.getPlan('missing')).toBeUndefined();
  });

  it('lists newest first with ops empty', () => {
    db.savePlan(plan('old', 1));
    db.savePlan(plan('new', 2, 'applied'));
    expect(db.listPlans().map((row) => row.id)).toEqual(['new', 'old']);
    expect(db.listPlans()[0]).toEqual({ ...plan('new', 2, 'applied'), ops: [] });
    expect(db.listPlans('applied')).toHaveLength(1);
    db.deletePlan('old');
    expect(db.listPlans()).toHaveLength(1);
  });
});
