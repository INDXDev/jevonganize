import { expect, test } from 'vitest';
import { callTool } from '../src/core/tools.ts';
import { ctx, setupToolContext } from './tools-helpers.ts';
import { findNode, generatedNames, LIBRARY, names, save, tagged } from './vfolders-helpers.ts';

setupToolContext();

/** The generated folders of the library, which are only built when asked for. */
async function listGenerated() {
  return callTool('list_vfolders', { generated: true }, ctx);
}

const FINANCE_FILES = ['budget.xlsx', 'tax-2024.pdf', 'tax-2025.pdf'];

test('one generated folder per namespace and loose tag, and none is stored', async () => {
  await tagged(LIBRARY);
  const { generated, saved } = await listGenerated();
  expect(saved).toEqual([]);
  expect(ctx.db.listVfolders()).toEqual([]);
  const topKeys = generated.map((node) => node.key);
  expect(topKeys).toEqual(['doc-date:', 'doc-type:', 'to-read', 'topic:']);
  expect(findNode(generated, 'to-read')).toMatchObject({ name: 'to-read', count: 1 });
});

test('generated folders nest values by `/`', async () => {
  await tagged(LIBRARY);
  const { generated } = await listGenerated();
  const topic = findNode(generated, 'topic:')!;
  expect(topic).toMatchObject({ name: 'topic', count: 3, folder: null });
  expect(topic.children).toMatchObject([
    {
      key: 'topic:finance',
      name: 'finance',
      count: 3,
      children: [{ key: 'topic:finance/tax', count: 2 }],
    },
  ]);
});

test('generated folders put months under their year', async () => {
  await tagged(LIBRARY);
  const { generated } = await listGenerated();
  expect(findNode(generated, 'doc-date:2025')).toMatchObject({
    count: 2,
    children: [{ key: 'doc-date:2025-03', name: '2025-03', count: 1 }],
  });
});

test('the folder list leaves generated folders out unless asked', async () => {
  await tagged(LIBRARY);
  expect((await callTool('list_vfolders', {}, ctx)).generated).toEqual([]);
});

test('a generated folder lists its files by key, and a namespace key lists every value', async () => {
  await tagged(LIBRARY);
  expect(await generatedNames('topic:finance')).toEqual(FINANCE_FILES);
  expect(await generatedNames('doc-date:')).toEqual(FINANCE_FILES);
  const { query } = await callTool('vfolder_files', { generated: 'topic:' }, ctx);
  expect(query).toEqual({ tags: ['topic:'] });
});

test('listing files needs either a saved id or a generated key', async () => {
  await expect(callTool('vfolder_files', {}, ctx)).rejects.toThrow('either');
});

test('pinning a generated folder saves it as a normal folder', async () => {
  await tagged(LIBRARY);
  const pinned = await save({
    name: 'finance',
    rule: { tags: ['topic:finance'], tag_match: 'all' },
  });
  expect(pinned.tag).toBe('topic:finance');
  expect(await names(pinned.id)).toEqual(FINANCE_FILES);
});
