import { rm } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { proposeRename, undoPlan } from '../src/core/plans.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import {
  aiTagged,
  apply,
  at,
  changeFile,
  db,
  idOf,
  organizeOp,
  organizePlan,
  put,
  run,
  scan,
  scanned,
  setupPlanLibrary,
  tagEverything,
} from './plans-helpers.ts';

setupPlanLibrary();

describe('undo', () => {
  test('restores an AI tag as AI, so a later answer can still replace it', async () => {
    const id = await aiTagged('doc-type:b');
    const applied = await apply(
      organizePlan([organizeOp('a.txt', ['doc-type:a'], ['doc-type:b'])]),
    );
    await undoPlan(db, applied, run());
    expect(db.fileTags(id)).toEqual([{ tag: 'doc-type:b', ai: true }]);
  });

  test('undoing a person’s removal clears its tombstone', async () => {
    const id = await aiTagged('topic:a');
    const applied = await apply(changeFile('a.txt', { remove: ['topic:a'] }));
    expect(db.rejectedTags(id)).toEqual(['topic:a']);
    await undoPlan(db, applied, run());
    expect(db.rejectedTags(id)).toEqual([]);
    expect(await readTags(at('a.txt'))).toEqual(['topic:a']);
  });

  test('restores what the plan removed', async () => {
    await put('a.txt', ['old']);
    await scan();
    const applied = await apply(proposeRename(db, 'old', 'new', 'user'));
    await undoPlan(db, applied, run());
    expect(await readTags(at('a.txt'))).toEqual(['old']);
    expect(db.fileTags(idOf('a.txt'))).toEqual([{ tag: 'old', ai: false }]);
  });
});

describe('undo after things changed', () => {
  test('a cancelled undo stays applied, keeps only what is left, and can finish', async () => {
    await scanned('a.txt', 'b.txt');
    const applied = await apply(tagEverything());
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

  test('a tag added after the plan ran stays', async () => {
    await scanned('a.txt');
    const applied = await apply(changeFile('a.txt', { add: ['x'] }));
    await writeTags(at('a.txt'), ['later', 'x']);
    expect(await undoPlan(db, applied, run())).toMatchObject({ status: 'undone' });
    expect(await readTags(at('a.txt'))).toEqual(['later']);
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
    await scanned('a.txt');
    const applied = await apply(changeFile('a.txt', { add: ['x'] }));
    await writeTags(at('a.txt'), []);
    expect(await undoPlan(db, applied, run())).toMatchObject({ status: 'undone' });
  });

  test('a missing file fails that op and stays to undo, and the rest are undone', async () => {
    await scanned('a.txt', 'b.txt');
    const applied = await apply(tagEverything());
    const id = idOf('a.txt');
    await rm(at('a.txt'));
    const undone = await undoPlan(db, applied, run());
    expect(undone.status).toBe('applied');
    expect(undone.ops.map((op) => op.file_id)).toEqual([id]);
    expect(Object.keys(undone.errors ?? {})).toEqual([String(id)]);
    expect(await readTags(at('b.txt'))).toEqual([]);
  });
});
