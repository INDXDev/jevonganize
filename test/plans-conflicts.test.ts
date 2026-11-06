import { rename, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
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
  scan,
  scanned,
  setupPlanLibrary,
} from './plans-helpers.ts';

setupPlanLibrary();

describe('conflicts since an organize plan was made', () => {
  test('refuses to remove a tag a person added back', async () => {
    const id = await aiTagged('doc-type:b');
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
    await scanned('a.txt');
    const plan = organizePlan([organizeOp('a.txt', ['topic:a'])]);
    await writeTags(at('a.txt'), ['one', 'two']);
    const applied = await apply(plan, undefined, 2);
    expect(applied.errors?.[idOf('a.txt')]).toContain('max_tags');
    expect(await readTags(at('a.txt'))).toEqual(['one', 'two']);
  });

  test('refuses a file whose content changed', async () => {
    await scanned('a.txt');
    const plan = organizePlan([organizeOp('a.txt', ['doc-type:a'])]);
    await writeFile(at('a.txt'), 'a different document');
    const applied = await apply(plan);
    expect(applied.errors?.[idOf('a.txt')]).toContain('changed after this plan');
    expect(await readTags(at('a.txt'))).toEqual([]);
  });
});

describe('conflicts with what a person chose meanwhile', () => {
  test('refuses when a person set a single-valued facet meanwhile', async () => {
    await scanned('a.txt');
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
    await scanned('a.txt');
    const plan = organizePlan([organizeOp('a.txt', ['topic:a'])]);
    db.rejectTag(idOf('a.txt'), 'topic:a', 'no');
    expect((await apply(plan)).errors?.[idOf('a.txt')]).toContain('rejected');
  });

  test('a person’s plan names its tags outright, so it merges', async () => {
    await scanned('a.txt');
    const plan = changeFile('a.txt', { add: ['doc-type:a'] });
    await writeTags(at('a.txt'), ['doc-type:b']);
    expect((await apply(plan)).errors).toBeUndefined();
  });
});

describe('tags that went missing before a plan ran', () => {
  test('an AI tag a person removed gets a tombstone, though the write hides it from the scan', async () => {
    const id = await aiTagged('topic:a');
    await writeTags(at('a.txt'), []);
    await apply(changeFile('a.txt', { add: ['x'] }));
    await scan();
    expect(db.rejectedTags(id)).toEqual(['topic:a']);
  });

  test('a tag the op itself removes gets none', async () => {
    const id = await aiTagged('topic:a');
    await apply(organizePlan([organizeOp('a.txt', ['topic:b'], ['topic:a'])]));
    expect(db.rejectedTags(id)).toEqual([]);
  });

  test('a file replaced by a save raises a restore item, not a tombstone', async () => {
    const id = await aiTagged('topic:a');
    await writeFile(at('a.new'), 'saved');
    await rename(at('a.new'), at('a.txt'));
    await apply(changeFile('a.txt', { add: ['x'] }));
    expect(db.rejectedTags(id)).toEqual([]);
    expect(db.reviewsForFile(id).map(({ kind, tag }) => [kind, tag])).toEqual([
      ['restore', 'topic:a'],
    ]);
  });
});
