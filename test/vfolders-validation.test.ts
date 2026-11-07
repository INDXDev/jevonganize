import { mkdir } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { callTool } from '../src/core/tools.ts';
import { at, ctx, home, setupToolContext } from './tools-helpers.ts';
import { LIBRARY, save, savedFolders, tagged, tagsOf } from './vfolders-helpers.ts';

setupToolContext();

/** Saves a chain of folders with empty rules below `parent`, named L3 to L8, and returns the last id. */
async function chainUpToDepthEight(parent: number): Promise<number> {
  let deepest = parent;
  for (let depth = 3; depth <= 8; depth++) {
    deepest = (await save({ name: `L${depth}`, parent: deepest, rule: {} })).id;
  }
  return deepest;
}

test('a folder cannot be moved below itself or below its own child', async () => {
  const a = await save({ name: 'A', rule: {} });
  const b = await save({ name: 'B', parent: a.id, rule: {} });
  await expect(save({ id: a.id, name: 'A', parent: b.id, rule: {} })).rejects.toThrow('itself');
  await expect(save({ id: a.id, name: 'A', parent: a.id, rule: {} })).rejects.toThrow('itself');
});

test('a name is taken only beside a folder of the same name', async () => {
  const a = await save({ name: 'A', rule: {} });
  await save({ name: 'B', parent: a.id, rule: {} });
  await expect(save({ name: 'A', rule: {} })).rejects.toThrow('already');
  await expect(save({ name: 'B', parent: a.id, rule: {} })).rejects.toThrow('already');
  await save({ name: 'B', rule: {} }); // the same name elsewhere is fine
});

test('folders nest at most eight deep, also when a subtree is moved', async () => {
  const a = await save({ name: 'A', rule: {} });
  const b = await save({ name: 'B', parent: a.id, rule: {} });
  const deepest = await chainUpToDepthEight(b.id);
  await expect(save({ name: 'L9', parent: deepest, rule: {} })).rejects.toThrow('at most 8');

  // Moving a two-level subtree under the deepest folder would also pass eight.
  const c = await save({ name: 'C', rule: {} });
  await save({ name: 'D', parent: c.id, rule: {} });
  await expect(save({ id: c.id, name: 'C', parent: deepest, rule: {} })).rejects.toThrow(
    'at most 8',
  );
});

test('a name must hold text and no control characters', async () => {
  await expect(save({ name: ' ', rule: {} })).rejects.toThrow('needs a name');
  await expect(save({ name: 'x\u001b]0;pwned\u0007', rule: {} })).rejects.toThrow('control');
});

test('a parent must exist', async () => {
  await expect(save({ name: 'Orphan', parent: 999, rule: {} })).rejects.toThrow(
    'no virtual folder',
  );
});

test('a scope must be in a library, and inside the scope of every folder above', async () => {
  await mkdir(at('docs/sub'), { recursive: true });
  await mkdir(at('other'));
  const docs = await save({ name: 'Docs', rule: { folder: at('docs') } });
  await save({ name: 'Sub', parent: docs.id, rule: { folder: at('docs/sub') } });

  const outsideParent = save({ name: 'Out', parent: docs.id, rule: { folder: at('other') } });
  await expect(outsideParent).rejects.toThrow('outside');
  const leavesChildOutside = save({ id: docs.id, name: 'Docs', rule: { folder: at('other') } });
  await expect(leavesChildOutside).rejects.toThrow('scoped outside');
  const outsideLibraries = save({ name: 'Home', rule: { folder: home() } });
  await expect(outsideLibraries).rejects.toThrow('not in a library');
});

test('a rule is checked on write', async () => {
  const notAList = { name: 'Bad', rule: { tags: 'x' } } as never;
  await expect(save(notAList)).rejects.toThrow('save_vfolder');
  await expect(save({ name: 'Bad', rule: { tags: ['a;b'] } })).rejects.toThrow('cannot contain');
});

test('deleting removes the folders below it, and no file or tag', async () => {
  await tagged(LIBRARY);
  const a = await save({ name: 'A', rule: { tags: ['topic:finance'] } });
  await save({ name: 'B', parent: a.id, rule: {} });

  await callTool('delete_vfolder', { id: a.id }, ctx);

  expect(await savedFolders()).toEqual([]);
  expect(ctx.db.listVfolders()).toEqual([]);
  expect(await tagsOf('budget.xlsx')).toEqual(['doc-date:2025', 'topic:finance']);
  await expect(callTool('delete_vfolder', { id: a.id }, ctx)).rejects.toThrow('no virtual folder');
});

test('a damaged rule is checked on read: the folder is left out, and can still be deleted', async () => {
  const a = await save({ name: 'A', rule: {} });
  await save({ name: 'Below', parent: a.id, rule: {} });
  ctx.db.updateVfolder(a.id, { name: 'A', parent: null, rule: '{"tags":"nope"}', tag: null });

  expect(await savedFolders()).toEqual([]);
  await expect(callTool('vfolder_files', { id: a.id }, ctx)).rejects.toThrow('damaged');
  await callTool('delete_vfolder', { id: a.id }, ctx);
  expect(ctx.db.listVfolders()).toEqual([]);
});
