import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob, watchLibraries } from '../src/core/tools.ts';
import {
  as,
  at,
  ctx,
  events,
  home,
  idOf,
  root,
  scanAll,
  scanned,
  setupToolContext,
} from './tools-helpers.ts';

setupToolContext();

const filesEvents = () => events.filter((event) => event.type === 'files');

// A short 8.3 name on the Windows runner, and a symlink on macOS. A plain path on Linux has neither.
describe.runIf(tmpdir() !== realpathSync.native(tmpdir()))(
  'a path that is not the real path',
  () => {
    test('finds the same library and file as the real path', async () => {
      const alias = await mkdtemp(join(tmpdir(), 'jevonganize-alias-'));
      const real = realpathSync.native(alias);
      try {
        await writeFile(join(alias, 'a.txt'), 'x');
        expect((await callTool('add_library', { path: alias }, ctx)).path).toBe(real);
        await waitForJob((await callTool('scan', { path: alias }, ctx)).id);
        const file = await callTool('get_file', { path: join(alias, 'a.txt') }, ctx);
        expect(file.path).toBe(join(real, 'a.txt'));
        await callTool('remove_library', { path: alias }, ctx);
        expect(ctx.db.fileByPath(join(real, 'a.txt'))).toBeUndefined();
      } finally {
        await rm(real, { recursive: true, force: true });
      }
    });
  },
);

describe('symlinked libraries', () => {
  test('a link to a secret folder is refused', async () => {
    const secret = join(home(), '.aws');
    await mkdir(secret);
    await writeFile(join(secret, 'credentials'), 'key');
    const link = join(home(), 'innocent');
    await symlink(secret, link);
    await expect(callTool('add_library', { path: link }, ctx)).rejects.toThrow('excluded');
    expect(ctx.db.listLibraries().map(({ path }) => path)).toEqual([root]);
  });

  test('another link is stored by its real path, so exclusions see where it leads', async () => {
    const real = join(home(), 'real');
    await mkdir(real);
    const link = join(home(), 'link');
    await symlink(real, link);
    const { path } = await callTool('add_library', { path: link }, ctx);
    expect(path).toBe(await realpath(real));
  });
});

describe('libraries', () => {
  test('adds, lists and removes, and removing leaves tags on the files', async () => {
    await scanned('a.txt');
    await writeTags(at('a.txt'), ['keep']);
    expect(await callTool('list_libraries', {}, ctx)).toMatchObject([
      { path: root, files: 1, taggable: true },
    ]);
    await callTool('remove_library', { path: root }, ctx);
    expect(await callTool('list_libraries', {}, ctx)).toEqual([]);
    expect(await readTags(at('a.txt'))).toEqual(['keep']);
  });

  test('refuses a path that is not a folder', async () => {
    await expect(callTool('add_library', { path: at('none') }, ctx)).rejects.toThrow(
      'not a folder',
    );
  });

  test('browse lists visible child folders and the parent', async () => {
    await mkdir(at('b'));
    await mkdir(at('a'));
    await mkdir(at('.hidden'));
    await writeFile(at('f.txt'), '');
    const result = await callTool('browse_dirs', { path: root }, ctx);
    expect(result).toMatchObject({ path: root, parent: home() });
    expect(result.places[0]).toBe(homedir());
    const entries = result.entries.toSorted((x, y) => x.name.localeCompare(y.name));
    expect(entries.map(({ name, dir }) => [name, dir])).toEqual([
      ['.hidden', true],
      ['a', true],
      ['b', true],
      ['f.txt', false],
    ]);
    expect(entries.at(-1)).toMatchObject({ size: 0, modified: expect.any(Number) });
    await expect(callTool('browse_dirs', { path: at('none') }, ctx)).rejects.toThrow(UserError);
    await expect(callTool('browse_dirs', { path: at('f.txt') }, ctx)).rejects.toThrow(UserError);
  });
});

describe('scanning', () => {
  test('scan refuses a path outside a library, so a model cannot widen its reach', async () => {
    await expect(callTool('scan', { path: home() }, as('mcp'))).rejects.toThrow('not a library');
  });

  test('scan reports counts and warnings on the job, and files by event', async () => {
    await scanned('a.txt');
    const { scan, warnings } = await scanAll();
    expect(scan).toMatchObject({ files: 1, added: 0 });
    expect(warnings).toEqual([]);
    expect(events).toContainEqual({ type: 'files', ids: [idOf('a.txt')] });
  });

  test('scanning all goes past an unplugged library, and warns', async () => {
    await scanned('a.txt');
    const second = at('drive');
    await mkdir(second);
    await callTool('add_library', { path: second }, ctx);
    await rm(second, { recursive: true });
    const job = await scanAll();
    expect(job.status).toBe('done');
    expect(job.warnings?.join()).toContain('drive');
    const named = await waitForJob((await callTool('scan', { path: second }, ctx)).id);
    expect(named.status).toBe('failed');
  });

  test('a scan leaves facet weights on tags, so similarity can read them', async () => {
    await writeFile(at('a.txt'), 'x');
    await writeTags(at('a.txt'), ['has-pii', 'flag:has-pii', 'language:en']);
    await scanAll();
    const tags = await callTool('list_tags', { facet: 'has-pii' }, ctx);
    expect(tags).toMatchObject([{ tag: 'flag:has-pii', facet: 'has-pii' }]);
  });
});

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
      for (const name of ['a.txt', 'b.txt', 'c.txt']) {
        await writeFile(at(name), name);
        await new Promise((done) => setTimeout(done, 400));
      }
      await vi.waitFor(() => expect(filesEvents()).not.toEqual([]), {
        timeout: 9000,
        interval: 50,
      });
    } finally {
      await stop();
    }
    expect(filesEvents()).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(filesEvents()[0]).toMatchObject({
      ids: expect.arrayContaining([idOf('a.txt'), idOf('c.txt')]),
    });
  });

  test('cleanup_report stays quick at 3,000 tags', async () => {
    await scanned('a.txt');
    const names = Array.from({ length: 3000 }, (_, n) => `topic:label-${n}`);
    ctx.db.addFileTags(idOf('a.txt'), names, false);
    const started = performance.now();
    const report = await callTool('cleanup_report', {}, ctx);
    expect(performance.now() - started).toBeLessThan(2500); // under coverage, on a busy machine
    expect(report.single_use).toHaveLength(3000);
  });

  test('search_files has a default page for every caller, and a person can ask for more', async () => {
    ctx.db.transaction(() => {
      for (let n = 0; n < 60; n++) {
        const file = { path: at(`f${n}`), dev: '1', ino: String(n), size: 1 };
        ctx.db.upsertFile({ ...file, mtime_ns: '1', ctime_ns: '1' }, { edited: false });
      }
    });
    expect(await callTool('search_files', {}, ctx)).toMatchObject({ total: 60 });
    expect((await callTool('search_files', {}, ctx)).files).toHaveLength(50);
    expect((await callTool('search_files', { limit: 60 }, ctx)).files).toHaveLength(60);
  });
});

describe('files', () => {
  test('search caps what a model gets, and leaves a person’s limit alone', async () => {
    await scanned(...Array.from({ length: 60 }, (_, index) => `${index}.txt`));
    expect((await callTool('search_files', { limit: 9999 }, ctx)).files).toHaveLength(60);
    expect((await callTool('search_files', {}, as('mcp'))).files).toHaveLength(50);
    expect((await callTool('search_files', { limit: 9999 }, as('mcp'))).files).toHaveLength(60);
  });

  test('get_file finds by id or path, and says how to fix a miss', async () => {
    await scanned('a.txt');
    const byPath = await callTool('get_file', { path: at('a.txt') }, ctx);
    expect(byPath).toMatchObject({ name: 'a.txt', taggable: true });
    expect((await callTool('get_file', { id: byPath.id }, ctx)).path).toBe(at('a.txt'));
    await expect(callTool('get_file', { path: at('b.txt') }, ctx)).rejects.toThrow(
      'jevonganize scan',
    );
    await expect(callTool('get_file', {}, ctx)).rejects.toThrow('id or a path');
  });

  test('similar_files and status read the index', async () => {
    await writeFile(at('a.txt'), 'a');
    await writeFile(at('b.txt'), 'b');
    await writeTags(at('a.txt'), ['t']);
    await writeTags(at('b.txt'), ['t']);
    await scanAll();
    const similar = await callTool('similar_files', { id: idOf('a.txt') }, ctx);
    expect(similar.map((file) => file.name)).toEqual(['b.txt']);
    const status = await callTool('status', {}, ctx);
    expect(status).toMatchObject({ files: 2, tags: 1, provider: 'openai', has_key: false });
  });

  test('a query takes tag_match and refuses any other mode', async () => {
    await expect(
      callTool('search_files', { tags: ['a:b'], tag_match: 'some' as never }, ctx),
    ).rejects.toThrow(UserError);
    const { total } = await callTool('search_files', { tags: ['a:b'], tag_match: 'any' }, ctx);
    expect(total).toBe(0);
  });
});
