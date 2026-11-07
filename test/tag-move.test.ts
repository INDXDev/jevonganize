import { writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import type { Plan } from '../src/types.ts';
import { at, ctx, scanAll, setupToolContext } from './tools-helpers.ts';

setupToolContext();

/** Writes each file with its tags on disk, then scans, so the index holds them as a person's. */
async function filesWith(tagsByName: Record<string, string[]>): Promise<void> {
  for (const [name, tags] of Object.entries(tagsByName)) {
    await writeFile(at(name), `text of ${name}`);
    await writeTags(at(name), tags);
  }
  await scanAll();
}

const apply = async (plan: Plan) =>
  waitForJob((await callTool('apply_plan', { id: plan.id }, ctx)).id);
const undo = async (plan: Plan) =>
  waitForJob((await callTool('undo_plan', { id: plan.id }, ctx)).id);
const move = (from: string, parent: string | null) => callTool('move_tag', { from, parent }, ctx);
const tagsOf = async (...names: string[]) => Promise.all(names.map((name) => readTags(at(name))));

describe('move_tag', () => {
  test('moves a tag and every tag under it, and undo puts them back', async () => {
    await filesWith({ 'a.txt': ['topic:tax', 'to-read'], 'b.txt': ['topic:tax/vat'] });
    const plan = await move('topic:tax', 'topic:finance');
    expect(plan.renames).toEqual([{ from: 'topic:tax', to: 'topic:finance/tax' }]);
    expect(plan.merges).toBeUndefined();
    expect(await tagsOf('a.txt', 'b.txt')).toEqual([['to-read', 'topic:tax'], ['topic:tax/vat']]);

    await apply(plan);
    expect(await tagsOf('a.txt', 'b.txt')).toEqual([
      ['to-read', 'topic:finance/tax'],
      ['topic:finance/tax/vat'],
    ]);
    await undo(plan);
    expect(await tagsOf('a.txt', 'b.txt')).toEqual([['to-read', 'topic:tax'], ['topic:tax/vat']]);
  });

  test('moves a tag to the top, and plain tags move within their own tree', async () => {
    await filesWith({ 'a.txt': ['topic:finance/tax/vat', 'year/2024/q1'] });
    await apply(await move('topic:finance/tax', null));
    await apply(await move('year/2024', 'archive'));
    expect(await tagsOf('a.txt')).toEqual([['archive/2024/q1', 'topic:tax/vat']]);
  });

  test('merges into a tag that already exists, and says so', async () => {
    await filesWith({
      'a.txt': ['topic:tax'],
      'b.txt': ['topic:finance/tax'],
      'c.txt': ['topic:tax'],
    });
    const plan = await move('topic:tax', 'topic:finance');
    expect(plan.merges).toEqual([{ from: 'topic:tax', into: 'topic:finance/tax', files: 2 }]);
    await apply(plan);
    expect(await tagsOf('a.txt', 'b.txt', 'c.txt')).toEqual([
      ['topic:finance/tax'],
      ['topic:finance/tax'],
      ['topic:finance/tax'],
    ]);
  });

  test.each([
    ['under its own child', 'topic:a', 'topic:a/b', 'under itself'],
    ['under itself', 'topic:a', 'topic:a', 'under itself'],
    ['into another facet', 'topic:a', 'party:acme', 'another facet'],
    ['from plain tags into a facet', 'to-read', 'topic:a', 'another facet'],
    ['a closed facet label', 'doc-type:invoice', null, 'fixed'],
    ['a flag', 'flag:has-signature', null, 'fixed'],
    ['a facet root', 'topic:', null, 'always a root'],
    ['to where it already is', 'topic:a', null, 'already there'],
    ['a tag no file has', 'topic:none', 'topic:a', 'No file has'],
    ['under a flag', 'topic:a/b', 'flag:has-signature', 'another facet'],
  ])('refuses moving %s', async (_, from, parent, message) => {
    await filesWith({ 'a.txt': ['topic:a', 'topic:a/b', 'to-read', 'doc-type:invoice'] });
    const refused = move(from, parent);
    await expect(refused).rejects.toThrow(UserError);
    await expect(refused).rejects.toThrow(message);
    expect(ctx.db.listPlans()).toEqual([]);
  });

  test('refuses a move that would take a tag past six levels', async () => {
    await filesWith({ 'a.txt': ['topic:a/b/c/d/e', 'topic:x', 'topic:x/y'] });
    await expect(move('topic:x/y', 'topic:a/b/c/d/e')).resolves.toMatchObject({
      status: 'proposed',
    });
    await expect(move('topic:x', 'topic:a/b/c/d/e')).rejects.toThrow('7 levels deep');
    await expect(move('topic:x/y', 'topic:a/b/c/d/e/f')).rejects.toThrow('7 levels deep');
  });
});

/** The topic vocabulary, as value to state. */
const vocabulary = async () => {
  const rows = await callTool('list_vocabulary', { facet: 'topic' }, ctx);
  return Object.fromEntries(rows.map((row) => [row.value, row.state]));
};

/** The favorite tags, in order. */
const starred = async () => (await callTool('list_favorite_tags', {}, ctx)).map((row) => row.tag);

describe('what follows a move', () => {
  test('the vocabulary retires the old path and turns the new one active, until undo', async () => {
    await filesWith({ 'a.txt': ['topic:tax/vat'] });
    await callTool('set_vocabulary', { facet: 'topic', value: 'tax', state: 'active' }, ctx);
    const plan = await move('topic:tax', 'topic:money');
    await apply(plan);
    expect(await vocabulary()).toEqual({
      tax: 'retired',
      'tax/vat': 'retired',
      'money/tax': 'active',
      'money/tax/vat': 'active',
    });
    await undo(plan);
    expect(await vocabulary()).toEqual({ tax: 'active' });
  });

  test('virtual folders follow, namespaces stay, and undo restores them', async () => {
    await filesWith({ 'a.txt': ['topic:tax'], 'b.txt': ['topic:tax/vat'] });
    const home = await callTool(
      'save_vfolder',
      { name: 'Tax', rule: { tags: ['topic:tax'] } },
      ctx,
    );
    const rule = { tags: ['topic:'], exclude_tags: ['topic:tax/vat'], tag_match: 'any' as const };
    const wide = await callTool('save_vfolder', { name: 'Wide', rule }, ctx);
    const plan = await move('topic:tax', 'topic:finance');
    await apply(plan);
    const moved = ctx.db.getVfolder(home.id)!;
    expect(moved.tag).toBe('topic:finance/tax');
    expect(JSON.parse(moved.rule)).toMatchObject({ tags: ['topic:finance/tax'] });
    expect(JSON.parse(ctx.db.getVfolder(wide.id)!.rule)).toMatchObject({
      tags: ['topic:'],
      exclude_tags: ['topic:finance/tax/vat'],
    });
    const files = await callTool('vfolder_files', { id: home.id }, ctx);
    expect(files.total).toBe(2);

    await undo(plan);
    expect(ctx.db.getVfolder(home.id)).toMatchObject({ tag: 'topic:tax' });
    expect(JSON.parse(ctx.db.getVfolder(home.id)!.rule)).toMatchObject({ tags: ['topic:tax'] });
    expect(JSON.parse(ctx.db.getVfolder(wide.id)!.rule).exclude_tags).toEqual(['topic:tax/vat']);
  });

  test('favorite tags take the new name in their place, until undo', async () => {
    await filesWith({ 'a.txt': ['topic:tax/vat'], 'b.txt': ['x'] });
    for (const tag of ['x', 'topic:tax', 'topic:tax/vat']) {
      await callTool('set_favorite_tag', { tag, favorite: true }, ctx);
    }
    const plan = await move('topic:tax', 'topic:finance');
    await apply(plan);
    expect(await starred()).toEqual(['x', 'topic:finance/tax', 'topic:finance/tax/vat']);
    expect(await tagsOf('a.txt')).toEqual([['topic:finance/tax/vat']]);
    await undo(plan);
    expect(await starred()).toEqual(['x', 'topic:tax', 'topic:tax/vat']);
  });

  test('a plan that stays applied after a failed undo keeps the new names', async () => {
    await filesWith({ 'a.txt': ['topic:tax'] });
    const folder = await callTool(
      'save_vfolder',
      { name: 'Tax', rule: { tags: ['topic:tax'] } },
      ctx,
    );
    const plan = await move('topic:tax', 'topic:finance');
    await apply(plan);
    await writeTags(at('a.txt'), ['other']); // the added tag is gone, so undo refuses the op
    await undo(plan);
    expect(ctx.db.getPlan(plan.id)?.status).toBe('applied');
    expect(ctx.db.getVfolder(folder.id)?.tag).toBe('topic:finance/tax');
  });
});

describe('rename_tag', () => {
  test('with children renames an implicit parent and everything under it', async () => {
    await filesWith({ 'a.txt': ['topic:finance/tax'], 'b.txt': ['topic:finance/banking', 'x'] });
    const plan = await callTool(
      'rename_tag',
      { from: 'topic:finance', to: 'topic:money', children: true },
      ctx,
    );
    expect(plan.renames).toEqual([{ from: 'topic:finance', to: 'topic:money' }]);
    await apply(plan);
    expect(await tagsOf('a.txt', 'b.txt')).toEqual([
      ['topic:money/tax'],
      ['topic:money/banking', 'x'],
    ]);
  });

  test('with children refuses a new name under the old one', async () => {
    await filesWith({ 'a.txt': ['year/2024'] });
    const nested = callTool('rename_tag', { from: 'year', to: 'year/old', children: true }, ctx);
    await expect(nested).rejects.toThrow('under it');
  });

  test('without children renames only the tag itself, with no renames to follow', async () => {
    await filesWith({ 'a.txt': ['topic:finance', 'topic:finance/tax'] });
    const plan = await callTool('rename_tag', { from: 'topic:finance', to: 'topic:money' }, ctx);
    expect(plan.renames).toBeUndefined();
    await apply(plan);
    expect(await tagsOf('a.txt')).toEqual([['topic:finance/tax', 'topic:money']]);
  });
});
