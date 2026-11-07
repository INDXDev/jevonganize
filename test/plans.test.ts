import { execFileSync } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import bplist from 'bplist-creator';
import { describe, expect, test } from 'vitest';
import { proposeChanges, proposeRename, proposeReviews, undoPlan } from '../src/core/plans.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import type { Job } from '../src/types.ts';
import {
  apply,
  applyWith,
  at,
  changeFile,
  db,
  idOf,
  organizeOp,
  organizePlan,
  put,
  root,
  run,
  scan,
  scanned,
  setupPlanLibrary,
  tagEverything,
} from './plans-helpers.ts';

setupPlanLibrary();

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
    await scanned('a.txt');
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
    const plan = changeFile('a.txt', { add: ['new'], remove: ['old'] });
    await writeTags(at('a.txt'), ['old', 'elsewhere']);
    const applied = await apply(plan);
    expect(await readTags(at('a.txt'))).toEqual(['elsewhere', 'new']);
    expect(db.fileTags(idOf('a.txt')).map((row) => row.tag)).toEqual(['elsewhere', 'new']);
    expect(applied.ops).toEqual([{ file_id: idOf('a.txt'), add: ['new'], remove: ['old'] }]);
  });

  test('stores what really changed, so undo reverses only that', async () => {
    await scanned('a.txt');
    const plan = changeFile('a.txt', { add: ['x', 'y'] });
    await writeTags(at('a.txt'), ['x']); // a person got there first
    const applied = await apply(plan);
    expect(applied.ops[0]?.add).toEqual(['y']);
    expect(applied.summary.added).toEqual({ y: 1 });
    await undoPlan(db, applied, run());
    expect(await readTags(at('a.txt'))).toEqual(['x']);
  });

  test('the next scan sees nothing to do, because the fingerprint was stored', async () => {
    await scanned('a.txt');
    const plan = changeFile('a.txt', { add: ['x'] });
    await apply(plan);
    expect(await scan()).toMatchObject({ changed: 0, added: 0 });
  });

  test('an edit behind the index stays visible to the next scan', async () => {
    await scanned('a.txt');
    const plan = changeFile('a.txt', { add: ['x'] });
    await writeFile(at('a.txt'), 'edited, and longer than before');
    await apply(plan);
    expect((await scan()).changed).toBe(1);
    expect(db.fileByPath(at('a.txt'))?.status).toBe('new');
  });
});

describe('provenance of what apply writes', () => {
  test('records provenance: organize is AI, a person’s plan and an accepted review are not', async () => {
    await scanned('a.txt', 'b.txt');
    await apply(organizePlan([organizeOp('a.txt', ['doc-type:a'])]));
    expect(db.fileTags(idOf('a.txt'))).toEqual([{ tag: 'doc-type:a', ai: true }]);

    const id = idOf('b.txt');
    db.addReview({ file_id: id, kind: 'suggest', tag: 'topic:a', confidence: 0.6, reason: 'r' });
    await apply(proposeReviews(db, db.listReviews(), 'user'));
    expect(db.fileTags(id)).toEqual([{ tag: 'topic:a', ai: false }]);
  });

  test('a person removing an AI tag leaves a tombstone, and undoing organize does not', async () => {
    await scanned('a.txt');
    const id = idOf('a.txt');
    const organized = await apply(organizePlan([organizeOp('a.txt', ['topic:a'])]));
    await undoPlan(db, organized, run());
    expect(db.rejectedTags(id)).toEqual([]);

    await apply(organizePlan([organizeOp('a.txt', ['topic:a'])]));
    await apply(changeFile('a.txt', { remove: ['topic:a'] }));
    expect(db.rejectedTags(id)).toEqual(['topic:a']);
  });
});

describe('apply when a file fails', () => {
  test('a failed op is recorded, and the rest continue', async () => {
    await scanned('a.txt', 'b.txt');
    const plan = tagEverything();
    await rm(at('a.txt'));
    const applied = await apply(plan);
    expect(applied.status).toBe('applied');
    expect(Object.keys(applied.errors ?? {})).toEqual([String(idOf('a.txt'))]);
    expect(await readTags(at('b.txt'))).toEqual(['x']);
  });

  test('a plan with every op failed is failed, and a moved file names itself', async () => {
    await scanned('a.txt');
    const plan = tagEverything();
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
});

describe('a running apply', () => {
  test('cancelling stops between ops, and nothing done means it can still run', async () => {
    await scanned('a.txt');
    const plan = tagEverything();
    const controller = new AbortController();
    controller.abort();
    expect(await apply(plan, controller.signal)).toMatchObject({ status: 'proposed' });
    expect(await readTags(at('a.txt'))).toEqual([]);
  });

  test('reports progress per op', async () => {
    await scanned('a.txt');
    const patches: Partial<Job>[] = [];
    const plan = tagEverything();
    await applyWith(plan, run(patches));
    expect(patches).toContainEqual({ done: 1 });
  });
});
