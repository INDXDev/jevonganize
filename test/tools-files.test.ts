import { writeFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { writeTags } from '../src/core/tags.ts';
import { callTool, watchLibraries } from '../src/core/tools.ts';
import { as, at, ctx, events, idOf, scanAll, scanned, setupToolContext } from './tools-helpers.ts';

setupToolContext();

/** The `files` events the running context has emitted. */
const filesEvents = () => events.filter((event) => event.type === 'files');

/** Indexes `count` files straight into the database, without a scan. */
function indexWithoutScan(count: number) {
  ctx.db.transaction(() => {
    for (let n = 0; n < count; n++) {
      const file = { path: at(`f${n}`), dev: '1', ino: String(n), size: 1 };
      ctx.db.upsertFile({ ...file, mtime_ns: '1', ctime_ns: '1' }, { edited: false });
    }
  });
}

/** Writes files that each hold the tag `t` on disk, and scans them in. */
async function taggedT(...names: string[]) {
  for (const name of names) {
    await writeFile(at(name), name.slice(0, 1));
    await writeTags(at(name), ['t']);
  }
  await scanAll();
}

/** Writes files one at a time, far enough apart that the watcher sees each as its own change. */
async function writeOneByOne(names: string[]) {
  for (const name of names) {
    await writeFile(at(name), name);
    await new Promise((done) => setTimeout(done, 400));
  }
}

describe('index upkeep', () => {
  test('a scan refreshes the numbers once, and similarity can read them', async () => {
    const refresh = vi.spyOn(ctx.db, 'refreshIdf');
    await writeFile(at('a.txt'), 'a');
    await writeTags(at('a.txt'), ['t']);
    await scanned('b.txt');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ctx.db.fileById(idOf('a.txt'))?.tag_w).toBeGreaterThan(0);
  });

  test('watch events share one refresh and one files event', async () => {
    const refresh = vi.spyOn(ctx.db, 'refreshIdf');
    const stop = watchLibraries(ctx);
    try {
      await vi.waitFor(() => expect(ctx.db.listLibraries()[0]?.scanned_at).toBeTruthy());
      await writeOneByOne(['a.txt', 'b.txt', 'c.txt']);
      const someFilesEvent = () => expect(filesEvents()).not.toEqual([]);
      await vi.waitFor(someFilesEvent, { timeout: 9000, interval: 50 });
    } finally {
      await stop();
    }
    expect(filesEvents()).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(filesEvents()[0]).toMatchObject({
      ids: expect.arrayContaining([idOf('a.txt'), idOf('c.txt')]),
    });
  });
});

describe('search_files', () => {
  test('has a default page for every caller, and a person can ask for more', async () => {
    indexWithoutScan(60);
    expect(await callTool('search_files', {}, ctx)).toMatchObject({ total: 60 });
    expect((await callTool('search_files', {}, ctx)).files).toHaveLength(50);
    expect((await callTool('search_files', { limit: 60 }, ctx)).files).toHaveLength(60);
  });

  test('caps what a model gets, and leaves a person’s limit alone', async () => {
    await scanned(...Array.from({ length: 60 }, (_, index) => `${index}.txt`));
    expect((await callTool('search_files', { limit: 9999 }, ctx)).files).toHaveLength(60);
    expect((await callTool('search_files', {}, as('mcp'))).files).toHaveLength(50);
    expect((await callTool('search_files', { limit: 9999 }, as('mcp'))).files).toHaveLength(60);
  });

  test('a query takes tag_match and refuses any other mode', async () => {
    const unknownMode = { tags: ['a:b'], tag_match: 'some' as never };
    await expect(callTool('search_files', unknownMode, ctx)).rejects.toThrow(UserError);
    const { total } = await callTool('search_files', { tags: ['a:b'], tag_match: 'any' }, ctx);
    expect(total).toBe(0);
  });
});

describe('reading one file', () => {
  test('get_file finds by id or path', async () => {
    await scanned('a.txt');
    const byPath = await callTool('get_file', { path: at('a.txt') }, ctx);
    expect(byPath).toMatchObject({ name: 'a.txt', taggable: true });
    expect((await callTool('get_file', { id: byPath.id }, ctx)).path).toBe(at('a.txt'));
  });

  test('get_file says how to fix a miss', async () => {
    const unscanned = callTool('get_file', { path: at('b.txt') }, ctx);
    await expect(unscanned).rejects.toThrow('jevonganize scan');
    await expect(callTool('get_file', {}, ctx)).rejects.toThrow('id or a path');
  });

  test('similar_files finds files that share tags', async () => {
    await taggedT('a.txt', 'b.txt');
    const similar = await callTool('similar_files', { id: idOf('a.txt') }, ctx);
    expect(similar.map((file) => file.name)).toEqual(['b.txt']);
  });

  test('status counts files and tags, and says whether there is a key', async () => {
    await taggedT('a.txt', 'b.txt');
    const status = await callTool('status', {}, ctx);
    expect(status).toMatchObject({ files: 2, tags: 1, provider: 'openai', has_key: false });
  });
});
