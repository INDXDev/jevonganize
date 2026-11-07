import { expect, test } from 'vitest';
import { setupToolContext } from './tools-helpers.ts';
import { LIBRARY, names, save, savedFolders, saveTaxYears, tagged } from './vfolders-helpers.ts';

setupToolContext();

test('a saved folder collects the files that match its rule', async () => {
  await tagged(LIBRARY);
  const { taxes } = await saveTaxYears();
  expect(await names(taxes.id)).toEqual(['tax-2024.pdf', 'tax-2025.pdf']);
});

test('a child narrows its parent, and a year tag owns its months', async () => {
  await tagged(LIBRARY);
  const { year } = await saveTaxYears();
  // budget.xlsx holds `doc-date:2025` but not the parent's `topic:finance/tax`, so it stays out.
  expect(await names(year.id)).toEqual(['tax-2025.pdf']);
});

test('a file scanned in later joins the folders it matches on its own', async () => {
  await tagged(LIBRARY);
  const { year } = await saveTaxYears();
  await tagged({ 'tax-2025b.pdf': ['topic:finance/tax', 'doc-date:2025'] });
  expect(await names(year.id)).toEqual(['tax-2025.pdf', 'tax-2025b.pdf']);
});

test('the folder tree counts the files of each folder', async () => {
  await tagged({ ...LIBRARY, 'tax-2025b.pdf': ['topic:finance/tax', 'doc-date:2025'] });
  const { taxes } = await saveTaxYears();
  expect(await savedFolders()).toMatchObject([
    { key: String(taxes.id), name: 'Taxes', count: 3, children: [{ name: '2025', count: 2 }] },
  ]);
});

test('`any` matches a file holding one of the tags', async () => {
  await tagged(LIBRARY);
  const rule = { tags: ['doc-type:photo', 'to-read'], tag_match: 'any' as const };
  const any = await save({ name: 'Any', rule });
  expect(await names(any.id)).toEqual(['draft.txt', 'photo.jpg']);
});

test('`all` is the default and matches a file holding every tag', async () => {
  await tagged(LIBRARY);
  const all = await save({ name: 'All', rule: { tags: ['topic:finance', 'doc-date:2025'] } });
  expect(await names(all.id)).toEqual(['budget.xlsx', 'tax-2025.pdf']);
});

test('an excluded namespace leaves out every file holding a tag in it', async () => {
  await tagged(LIBRARY);
  const without = await save({ name: 'Without', rule: { exclude_tags: ['topic:'] } });
  expect(await names(without.id)).toEqual(['draft.txt', 'photo.jpg']);
});

test('an empty rule groups others and matches every file', async () => {
  await tagged(LIBRARY);
  const work = await save({ name: 'Work', rule: {} });
  expect(work).toMatchObject({ tag: null, rule: { tags: [], tag_match: 'all', exclude_tags: [] } });
  expect(await names(work.id)).toHaveLength(5);
});

test('the home tag defaults to the one tag of the rule, and only then', async () => {
  const one = await save({ name: 'One', rule: { tags: ['topic:finance'] } });
  const two = await save({ name: 'Two', rule: { tags: ['a', 'b'] } });
  const namespace = await save({ name: 'Ns', rule: { tags: ['topic:'] } });
  const chosen = await save({ name: 'Set', rule: { tags: ['a', 'b'] }, tag: 'a' });
  const homeTags = [one.tag, two.tag, namespace.tag, chosen.tag];
  expect(homeTags).toEqual(['topic:finance', null, null, 'a']);
});

test('a home tag must be one valid tag and not a namespace', async () => {
  await expect(save({ name: 'Bad', rule: {}, tag: 'a,b' })).rejects.toThrow('cannot contain');
  await expect(save({ name: 'Bad', rule: {}, tag: 'topic:' })).rejects.toThrow('home tag');
});
