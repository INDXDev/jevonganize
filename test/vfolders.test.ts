import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import type { VirtualFolderNode } from '../src/types.ts';
import { as, at, ctx, home, idOf, scanAll, setupToolContext } from './tools-helpers.ts';

setupToolContext();

/** Writes files with tags on disk, then scans them in. */
async function tagged(files: Record<string, string[]>) {
  for (const [name, tags] of Object.entries(files)) {
    await writeFile(at(name), `text of ${name}`);
    await writeTags(at(name), tags);
  }
  await scanAll();
}

const save = (input: Parameters<typeof callTool<'save_vfolder'>>[1]) =>
  callTool('save_vfolder', input, ctx);

const names = (id: number) =>
  callTool('vfolder_files', { id }, ctx).then(({ files }) =>
    files.map((file) => file.name).toSorted(),
  );

const generatedNames = (generated: string) =>
  callTool('vfolder_files', { generated }, ctx).then((r) => r.files.map((f) => f.name).toSorted());

const LIBRARY = {
  'tax-2024.pdf': ['topic:finance/tax', 'doc-date:2024'],
  'tax-2025.pdf': ['topic:finance/tax', 'doc-date:2025-03'],
  'budget.xlsx': ['topic:finance', 'doc-date:2025'],
  'photo.jpg': ['doc-type:photo'],
  'draft.txt': ['to-read'],
};

describe('saved folders', () => {
  test('collect matching files on their own, and a child narrows its parent', async () => {
    await tagged(LIBRARY);
    const taxes = await save({ name: 'Taxes', rule: { tags: ['topic:finance/tax'] } });
    const year = await save({ name: '2025', parent: taxes.id, rule: { tags: ['doc-date:2025'] } });
    expect(await names(taxes.id)).toEqual(['tax-2024.pdf', 'tax-2025.pdf']);
    // `doc-date:2025` owns its months, and the parent's rule still holds: budget.xlsx stays out.
    expect(await names(year.id)).toEqual(['tax-2025.pdf']);

    await tagged({ 'tax-2025b.pdf': ['topic:finance/tax', 'doc-date:2025'] });
    expect(await names(year.id)).toEqual(['tax-2025.pdf', 'tax-2025b.pdf']);

    const { saved } = await callTool('list_vfolders', {}, ctx);
    expect(saved).toMatchObject([
      { key: String(taxes.id), name: 'Taxes', count: 3, children: [{ name: '2025', count: 2 }] },
    ]);
  });

  test('any, all and exclusions follow the rule', async () => {
    await tagged(LIBRARY);
    const any = await save({
      name: 'Any',
      rule: { tags: ['doc-type:photo', 'to-read'], tag_match: 'any' },
    });
    const all = await save({ name: 'All', rule: { tags: ['topic:finance', 'doc-date:2025'] } });
    const without = await save({ name: 'Without', rule: { exclude_tags: ['topic:'] } });
    expect(await names(any.id)).toEqual(['draft.txt', 'photo.jpg']);
    expect(await names(all.id)).toEqual(['budget.xlsx', 'tax-2025.pdf']);
    expect(await names(without.id)).toEqual(['draft.txt', 'photo.jpg']);
  });

  test('an empty rule groups others and matches every file', async () => {
    await tagged(LIBRARY);
    const work = await save({ name: 'Work', rule: {} });
    expect(work).toMatchObject({
      tag: null,
      rule: { tags: [], tag_match: 'all', exclude_tags: [] },
    });
    expect(await names(work.id)).toHaveLength(5);
  });

  test('the home tag defaults to the one tag of the rule, and only then', async () => {
    const one = await save({ name: 'One', rule: { tags: ['topic:finance'] } });
    const two = await save({ name: 'Two', rule: { tags: ['a', 'b'] } });
    const ns = await save({ name: 'Ns', rule: { tags: ['topic:'] } });
    const set = await save({ name: 'Set', rule: { tags: ['a', 'b'] }, tag: 'a' });
    expect([one.tag, two.tag, ns.tag, set.tag]).toEqual(['topic:finance', null, null, 'a']);
    await expect(save({ name: 'Bad', rule: {}, tag: 'a,b' })).rejects.toThrow('cannot contain');
    await expect(save({ name: 'Bad', rule: {}, tag: 'topic:' })).rejects.toThrow('home tag');
  });

  test('refuses cycles, depth past eight, and a name already taken beside it', async () => {
    const a = await save({ name: 'A', rule: {} });
    const b = await save({ name: 'B', parent: a.id, rule: {} });
    await expect(save({ id: a.id, name: 'A', parent: b.id, rule: {} })).rejects.toThrow('itself');
    await expect(save({ id: a.id, name: 'A', parent: a.id, rule: {} })).rejects.toThrow('itself');
    await expect(save({ name: 'A', rule: {} })).rejects.toThrow('already');
    await expect(save({ name: 'B', parent: a.id, rule: {} })).rejects.toThrow('already');
    await save({ name: 'B', rule: {} }); // the same name elsewhere is fine

    let parent = b.id;
    for (let depth = 3; depth <= 8; depth++) {
      parent = (await save({ name: `L${depth}`, parent, rule: {} })).id;
    }
    await expect(save({ name: 'L9', parent, rule: {} })).rejects.toThrow('at most 8');
    // Moving a two-level subtree under the deepest folder would also pass eight.
    const c = await save({ name: 'C', rule: {} });
    await save({ name: 'D', parent: c.id, rule: {} });
    await expect(save({ id: c.id, name: 'C', parent, rule: {} })).rejects.toThrow('at most 8');
    await expect(save({ name: ' ', rule: {} })).rejects.toThrow('needs a name');
    await expect(save({ name: 'x\u001b]0;pwned\u0007', rule: {} })).rejects.toThrow('control');
    await expect(save({ name: 'Orphan', parent: 999, rule: {} })).rejects.toThrow(
      'no virtual folder',
    );
  });

  test('a scope must be in a library, and inside the scope of every folder above', async () => {
    await mkdir(at('docs/sub'), { recursive: true });
    await mkdir(at('other'));
    const docs = await save({ name: 'Docs', rule: { folder: at('docs') } });
    await save({ name: 'Sub', parent: docs.id, rule: { folder: at('docs/sub') } });
    await expect(
      save({ name: 'Out', parent: docs.id, rule: { folder: at('other') } }),
    ).rejects.toThrow('outside');
    await expect(
      save({ id: docs.id, name: 'Docs', rule: { folder: at('other') } }),
    ).rejects.toThrow('scoped outside');
    await expect(save({ name: 'Home', rule: { folder: home() } })).rejects.toThrow(
      'not in a library',
    );
  });

  test('deleting removes the folders below it, and no file or tag', async () => {
    await tagged(LIBRARY);
    const a = await save({ name: 'A', rule: { tags: ['topic:finance'] } });
    await save({ name: 'B', parent: a.id, rule: {} });
    await callTool('delete_vfolder', { id: a.id }, ctx);
    expect((await callTool('list_vfolders', {}, ctx)).saved).toEqual([]);
    expect(ctx.db.listVfolders()).toEqual([]);
    expect(await readTags(at('budget.xlsx'))).toEqual(['doc-date:2025', 'topic:finance']);
    await expect(callTool('delete_vfolder', { id: a.id }, ctx)).rejects.toThrow(
      'no virtual folder',
    );
  });

  test('a damaged rule is checked on read: the folder is left out, and can still be deleted', async () => {
    const a = await save({ name: 'A', rule: {} });
    await save({ name: 'Below', parent: a.id, rule: {} });
    ctx.db.updateVfolder(a.id, { name: 'A', parent: null, rule: '{"tags":"nope"}', tag: null });
    expect((await callTool('list_vfolders', {}, ctx)).saved).toEqual([]);
    await expect(callTool('vfolder_files', { id: a.id }, ctx)).rejects.toThrow('damaged');
    await callTool('delete_vfolder', { id: a.id }, ctx);
    expect(ctx.db.listVfolders()).toEqual([]);
  });

  test('a rule is checked on write', async () => {
    const bad = { name: 'Bad', rule: { tags: 'x' } } as never;
    await expect(save(bad)).rejects.toThrow('save_vfolder');
    await expect(save({ name: 'Bad', rule: { tags: ['a;b'] } })).rejects.toThrow('cannot contain');
  });
});

describe('generated folders', () => {
  const find = (nodes: VirtualFolderNode[], key: string): VirtualFolderNode | undefined =>
    nodes
      .flatMap((node) => [node, ...(find(node.children, key) ? [find(node.children, key)!] : [])])
      .find((node) => node.key === key);

  test('one per namespace, nested by `/`, months under their year, never stored', async () => {
    await tagged(LIBRARY);
    const { generated, saved } = await callTool('list_vfolders', { generated: true }, ctx);
    expect(saved).toEqual([]);
    expect(ctx.db.listVfolders()).toEqual([]);
    expect(generated.map((node) => node.key)).toEqual([
      'doc-date:',
      'doc-type:',
      'to-read',
      'topic:',
    ]);
    const topic = find(generated, 'topic:')!;
    expect(topic).toMatchObject({ name: 'topic', count: 3, folder: null });
    expect(topic.children).toMatchObject([
      {
        key: 'topic:finance',
        name: 'finance',
        count: 3,
        children: [{ key: 'topic:finance/tax', count: 2 }],
      },
    ]);
    const year = find(generated, 'doc-date:2025')!;
    expect(year).toMatchObject({
      count: 2,
      children: [{ key: 'doc-date:2025-03', name: '2025-03', count: 1 }],
    });
    expect(find(generated, 'to-read')).toMatchObject({ name: 'to-read', count: 1 });
    expect((await callTool('list_vfolders', {}, ctx)).generated).toEqual([]);
  });

  test('list their files by key, and a namespace key lists every value', async () => {
    await tagged(LIBRARY);
    expect(await generatedNames('topic:finance')).toEqual([
      'budget.xlsx',
      'tax-2024.pdf',
      'tax-2025.pdf',
    ]);
    expect(await generatedNames('doc-date:')).toEqual([
      'budget.xlsx',
      'tax-2024.pdf',
      'tax-2025.pdf',
    ]);
    expect((await callTool('vfolder_files', { generated: 'topic:' }, ctx)).query).toEqual({
      tags: ['topic:'],
    });
    await expect(callTool('vfolder_files', {}, ctx)).rejects.toThrow('either');
  });

  test('pinning saves one as a normal folder', async () => {
    await tagged(LIBRARY);
    const pinned = await save({
      name: 'finance',
      rule: { tags: ['topic:finance'], tag_match: 'all' },
    });
    expect(pinned.tag).toBe('topic:finance');
    expect(await names(pinned.id)).toEqual(['budget.xlsx', 'tax-2024.pdf', 'tax-2025.pdf']);
  });
});

describe('putting files in', () => {
  test('stores a plan, and applying it writes the home tags to disk, read back', async () => {
    await tagged({ 'new.pdf': [] });
    const taxes = await save({ name: 'Taxes', rule: { tags: ['topic:finance/tax'] } });
    const year = await save({ name: '2025', parent: taxes.id, rule: { tags: ['doc-date:2025'] } });
    const plan = await callTool(
      'add_to_vfolder',
      { id: year.id, file_ids: [idOf('new.pdf')] },
      ctx,
    );
    expect(plan).toMatchObject({ status: 'proposed', source: 'user' });
    expect(await readTags(at('new.pdf'))).toEqual([]); // nothing until apply
    await waitForJob((await callTool('apply_plan', { id: plan.id }, ctx)).id);
    expect(await readTags(at('new.pdf'))).toEqual(['doc-date:2025', 'topic:finance/tax']);
    expect(await names(year.id)).toEqual(['new.pdf']);

    const out = await callTool(
      'remove_from_vfolder',
      { id: year.id, file_ids: [idOf('new.pdf')] },
      ctx,
    );
    await waitForJob((await callTool('apply_plan', { id: out.id }, ctx)).id);
    expect(await readTags(at('new.pdf'))).toEqual(['topic:finance/tax']);
    expect(await names(year.id)).toEqual([]);
    expect(await names(taxes.id)).toEqual(['new.pdf']);

    await waitForJob((await callTool('undo_plan', { id: out.id }, ctx)).id);
    expect(await readTags(at('new.pdf'))).toEqual(['doc-date:2025', 'topic:finance/tax']);
  });

  test('a folder with no home tag refuses files', async () => {
    await tagged({ 'a.txt': [] });
    const both = await save({ name: 'Both', rule: { tags: ['a', 'b'] } });
    await expect(
      callTool('add_to_vfolder', { id: both.id, file_ids: [idOf('a.txt')] }, ctx),
    ).rejects.toThrow('no home tag');
    await expect(
      callTool('remove_from_vfolder', { id: both.id, file_ids: [idOf('a.txt')] }, ctx),
    ).rejects.toThrow('no home tag');
  });
});

describe('models', () => {
  test('may read folders and propose plans, and never save or delete one', async () => {
    await tagged({ 'a.txt': [] });
    const folder = await save({ name: 'A', rule: { tags: ['x'] } });
    for (const caller of ['chat', 'mcp'] as const) {
      await expect(callTool('save_vfolder', { name: 'B', rule: {} }, as(caller))).rejects.toThrow(
        'not offered',
      );
      await expect(callTool('delete_vfolder', { id: folder.id }, as(caller))).rejects.toThrow(
        'not offered',
      );
      expect((await callTool('list_vfolders', {}, as(caller))).saved).toHaveLength(1);
      const plan = await callTool(
        'add_to_vfolder',
        { id: folder.id, file_ids: [idOf('a.txt')] },
        as(caller),
      );
      expect(plan.source).toBe(caller);
      await expect(callTool('apply_plan', { id: plan.id }, as(caller))).rejects.toThrow('approve');
    }
    expect(await readTags(at('a.txt'))).toEqual([]);
  });
});
