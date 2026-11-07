import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
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

const listLibraries = () => callTool('list_libraries', {}, ctx);
const browse = (path: string) => callTool('browse_dirs', { path }, ctx);

// A short 8.3 name on the Windows runner, and a symlink on macOS. A plain path on Linux has neither.
const tempPathIsAnAlias = tmpdir() !== realpathSync.native(tmpdir());

describe.runIf(tempPathIsAnAlias)('a path that is not the real path', () => {
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
});

describe('symlinked libraries', () => {
  test('a link to a secret folder is refused', async () => {
    const secret = join(home(), '.aws');
    await mkdir(secret);
    await writeFile(join(secret, 'credentials'), 'key');
    const innocentLink = join(home(), 'innocent');
    await symlink(secret, innocentLink);
    await expect(callTool('add_library', { path: innocentLink }, ctx)).rejects.toThrow('excluded');
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
  test('lists a library with its file count', async () => {
    await scanned('a.txt');
    expect(await listLibraries()).toMatchObject([{ path: root, files: 1, taggable: true }]);
  });

  test('removing a library leaves the tags on its files', async () => {
    await scanned('a.txt');
    await writeTags(at('a.txt'), ['keep']);
    await callTool('remove_library', { path: root }, ctx);
    expect(await listLibraries()).toEqual([]);
    expect(await readTags(at('a.txt'))).toEqual(['keep']);
  });

  test('refuses a path that is not a folder', async () => {
    const notAFolder = callTool('add_library', { path: at('none') }, ctx);
    await expect(notAFolder).rejects.toThrow('not a folder');
  });
});

describe('browse_dirs', () => {
  test('lists the children, hidden ones too, with the parent and the places', async () => {
    await mkdir(at('b'));
    await mkdir(at('a'));
    await mkdir(at('.hidden'));
    await writeFile(at('f.txt'), '');
    const result = await browse(root);
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
  });

  test('refuses a missing path and a file', async () => {
    await writeFile(at('f.txt'), '');
    await expect(browse(at('none'))).rejects.toThrow(UserError);
    await expect(browse(at('f.txt'))).rejects.toThrow(UserError);
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
    const unplugged = at('drive');
    await mkdir(unplugged);
    await callTool('add_library', { path: unplugged }, ctx);
    await rm(unplugged, { recursive: true });

    const everyLibrary = await scanAll();
    expect(everyLibrary.status).toBe('done');
    expect(everyLibrary.warnings?.join()).toContain('drive');
    const onlyUnplugged = await waitForJob((await callTool('scan', { path: unplugged }, ctx)).id);
    expect(onlyUnplugged.status).toBe('failed');
  });

  test('a scan leaves facet weights on tags, so similarity can read them', async () => {
    await writeFile(at('a.txt'), 'x');
    await writeTags(at('a.txt'), ['has-pii', 'flag:has-pii', 'language:en']);
    await scanAll();
    const tags = await callTool('list_tags', { facet: 'has-pii' }, ctx);
    expect(tags).toMatchObject([{ tag: 'flag:has-pii', facet: 'has-pii' }]);
  });
});
