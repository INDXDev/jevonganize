import { expect, test } from 'vitest';
import { callTool } from '../src/core/tools.ts';
import { as, ctx, setupToolContext } from './tools-helpers.ts';
import {
  applyPlan,
  fileIds,
  names,
  save,
  saveTaxYears,
  tagged,
  tagsOf,
  undoPlan,
} from './vfolders-helpers.ts';

setupToolContext();

const TAX_2025_TAGS = ['doc-date:2025', 'topic:finance/tax'];

/** Puts new.pdf into the 2025 folder below Taxes, through an applied plan. */
async function newFileInTaxYear() {
  await tagged({ 'new.pdf': [] });
  const folders = await saveTaxYears();
  const added = await callTool(
    'add_to_vfolder',
    { id: folders.year.id, file_ids: fileIds('new.pdf') },
    ctx,
  );
  await applyPlan(added.id);
  return folders;
}

/** Takes new.pdf out of the 2025 folder through an applied plan, and returns the plan. */
async function takeOutOfYear(yearId: number) {
  const removed = await callTool(
    'remove_from_vfolder',
    { id: yearId, file_ids: fileIds('new.pdf') },
    ctx,
  );
  await applyPlan(removed.id);
  return removed;
}

test('putting a file in stores a plan and writes nothing until it is applied', async () => {
  await tagged({ 'new.pdf': [] });
  const { year } = await saveTaxYears();
  const plan = await callTool('add_to_vfolder', { id: year.id, file_ids: fileIds('new.pdf') }, ctx);
  expect(plan).toMatchObject({ status: 'proposed', source: 'user' });
  expect(await tagsOf('new.pdf')).toEqual([]);
});

test('applying the plan writes the home tags of the folder and those above it, read back', async () => {
  const { year } = await newFileInTaxYear();
  expect(await tagsOf('new.pdf')).toEqual(TAX_2025_TAGS);
  expect(await names(year.id)).toEqual(['new.pdf']);
});

test('taking a file out removes only the home tag of that folder', async () => {
  const { taxes, year } = await newFileInTaxYear();
  await takeOutOfYear(year.id);
  expect(await tagsOf('new.pdf')).toEqual(['topic:finance/tax']);
  expect(await names(year.id)).toEqual([]);
  expect(await names(taxes.id)).toEqual(['new.pdf']);
});

test('taking a file out can be undone', async () => {
  const { year } = await newFileInTaxYear();
  const removed = await takeOutOfYear(year.id);
  await undoPlan(removed.id);
  expect(await tagsOf('new.pdf')).toEqual(TAX_2025_TAGS);
});

test('a folder with no home tag refuses files', async () => {
  await tagged({ 'a.txt': [] });
  const both = await save({ name: 'Both', rule: { tags: ['a', 'b'] } });
  const change = { id: both.id, file_ids: fileIds('a.txt') };
  await expect(callTool('add_to_vfolder', change, ctx)).rejects.toThrow('no home tag');
  await expect(callTool('remove_from_vfolder', change, ctx)).rejects.toThrow('no home tag');
});

test.each(['chat', 'mcp'] as const)(
  '%s may read folders and propose plans, and never save, delete or apply',
  async (caller) => {
    await tagged({ 'a.txt': [] });
    const folder = await save({ name: 'A', rule: { tags: ['x'] } });
    const model = as(caller);

    const saving = callTool('save_vfolder', { name: 'B', rule: {} }, model);
    await expect(saving).rejects.toThrow('not offered');
    await expect(callTool('delete_vfolder', { id: folder.id }, model)).rejects.toThrow(
      'not offered',
    );
    expect((await callTool('list_vfolders', {}, model)).saved).toHaveLength(1);

    const plan = await callTool(
      'add_to_vfolder',
      { id: folder.id, file_ids: fileIds('a.txt') },
      model,
    );
    expect(plan.source).toBe(caller);
    await expect(callTool('apply_plan', { id: plan.id }, model)).rejects.toThrow('approve');
    expect(await tagsOf('a.txt')).toEqual([]);
  },
);
