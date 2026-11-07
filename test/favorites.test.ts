import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { callTool } from '../src/core/tools.ts';
import { as, ctx, home, idOf, scanned, setupToolContext } from './tools-helpers.ts';

setupToolContext();

const star = (tag: string, position?: number) =>
  callTool('set_favorite_tag', { tag, favorite: true, position }, ctx);
const unstar = (tag: string) => callTool('set_favorite_tag', { tag, favorite: false }, ctx);
const listed = async () => (await callTool('list_favorite_tags', {}, ctx)).map((row) => row.tag);

describe('favorite tags', () => {
  test('a star goes at the end, and a position puts it in place', async () => {
    await star('a');
    await star('b');
    await star('c', 0);
    expect(await listed()).toEqual(['c', 'a', 'b']);
    const rows = await callTool('list_favorite_tags', {}, ctx);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  test('starring again with a position moves it, and without one keeps it', async () => {
    for (const tag of ['a', 'b', 'c']) await star(tag);
    await star('a', 2);
    expect(await listed()).toEqual(['b', 'c', 'a']);
    await star('a');
    expect(await listed()).toEqual(['b', 'c', 'a']);
    await star('c', 99);
    expect(await listed()).toEqual(['b', 'a', 'c']);
  });

  test('unstarring removes it and closes the gap', async () => {
    for (const tag of ['a', 'b', 'c']) await star(tag);
    await unstar('b');
    await unstar('never-starred');
    const rows = await callTool('list_favorite_tags', {}, ctx);
    expect(rows.map(({ tag, position }) => [tag, position])).toEqual([
      ['a', 0],
      ['c', 1],
    ]);
  });

  test('counts the files carrying the tag, and keeps a tag no file carries', async () => {
    await scanned('a.txt', 'b.txt');
    ctx.db.addFileTags(idOf('a.txt'), ['topic:tax'], false);
    ctx.db.addFileTags(idOf('b.txt'), ['topic:tax'], false);
    await star('topic:tax');
    await star('gone');
    expect(await callTool('list_favorite_tags', {}, ctx)).toEqual([
      { tag: 'topic:tax', facet: null, count: 2, position: 0 },
      { tag: 'gone', facet: null, count: 0, position: 1 },
    ]);
    ctx.db.removeFileTags(idOf('a.txt'), ['topic:tax']);
    ctx.db.removeFileTags(idOf('b.txt'), ['topic:tax']);
    expect(await callTool('list_favorite_tags', {}, ctx)).toEqual([
      { tag: 'topic:tax', facet: null, count: 0, position: 0 },
      { tag: 'gone', facet: null, count: 0, position: 1 },
    ]);
  });

  test('writes no tag: starring is stored state only', async () => {
    await scanned('a.txt');
    await star('x');
    expect(ctx.db.fileRow(idOf('a.txt'))?.tags).toEqual([]);
    expect(ctx.db.listPlans()).toEqual([]);
  });

  test.each(['chat', 'mcp'] as const)(
    'a %s caller can list favorites but not set them',
    async (caller) => {
      await star('a');
      await expect(callTool('list_favorite_tags', {}, as(caller))).resolves.toHaveLength(1);
      const input = { tag: 'b', favorite: true };
      await expect(callTool('set_favorite_tag', input, as(caller))).rejects.toThrow('not offered');
      expect(await listed()).toEqual(['a']);
    },
  );

  test('an empty tag is refused', async () => {
    await expect(star('')).rejects.toThrow('set_favorite_tag');
  });
});

describe('favorites in the index', () => {
  test('survive reopening, and a version 5 index gains the table with its data kept', () => {
    const file = join(home(), 'index.db');
    const first = openDb(file);
    first.addLibrary('/lib');
    first.close();
    const raw = new DatabaseSync(file);
    raw.exec('DROP TABLE favorite_tag; DROP TABLE usage; PRAGMA user_version = 5');
    raw.close();
    const second = openDb(file);
    second.setFavoriteTag({ tag: 'kept', favorite: true });
    second.close();
    const third = openDb(file);
    expect(third.listLibraries().map((library) => library.path)).toEqual(['/lib']);
    expect(third.listFavoriteTags().map((row) => row.tag)).toEqual(['kept']);
    third.close();
  });
});
