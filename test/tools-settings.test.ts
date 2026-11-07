import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, copyFile, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { paths, UserError } from '../src/core/config.ts';
import { writeTags } from '../src/core/tags.ts';
import { callTool, tools } from '../src/core/tools.ts';
import type { Facet } from '../src/types.ts';
import { fixture } from './extract-helpers.ts';
import { as, at, ctx, idOf, scanAll, setupToolContext } from './tools-helpers.ts';

// A test must never start a real app. Each spawned process exits with `exitCode`.
let exitCode = 0;
vi.mock('node:child_process', async (actual) => ({
  ...(await actual<object>()),
  spawn: vi.fn<() => EventEmitter>(() => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', exitCode));
    return child;
  }),
}));

setupToolContext();

const removeKey = () => callTool('remove_api_key', { provider: 'openai' }, ctx);

const enabled = async (id: string) =>
  (await callTool('list_facets', {}, ctx)).find((facet) => facet.id === id)?.enabled;

describe('keys', () => {
  test('keys are listed and removed without ever being returned', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await callTool('set_api_key', { provider: 'openai', key: 'sk-secret' }, ctx);
    const listed = await callTool('list_keys', {}, ctx);
    expect(listed.keys).toContainEqual({ provider: 'openai', source: 'file', in_env: false });
    expect(listed.env_allowed).toBeNull();
    expect(JSON.stringify(listed)).not.toContain('sk-secret');
    expect(await removeKey()).toEqual({ removed: true });
    expect(await removeKey()).toEqual({ removed: false });
    await callTool('set_env_keys', { allowed: false }, ctx);
    expect((await callTool('list_keys', {}, ctx)).env_allowed).toBe(false);
    vi.unstubAllEnvs();
  });

  test('a key in the environment is reported as present, and unused until allowed', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-env-secret');
    const listed = await callTool('list_keys', {}, ctx);
    expect(listed.keys).toContainEqual({ provider: 'openai', source: null, in_env: true });
    expect(JSON.stringify(listed)).not.toContain('sk-env-secret');
    await callTool('set_env_keys', { allowed: true }, ctx);
    const allowed = await callTool('list_keys', {}, ctx);
    expect(allowed.keys).toContainEqual({ provider: 'openai', source: 'env', in_env: true });
    await callTool('set_env_keys', { allowed: false }, ctx);
    vi.unstubAllEnvs();
  });

  test('keeps keys out of reach of models', async () => {
    const asModel = as('mcp', true);
    for (const name of ['list_keys', 'remove_api_key', 'set_env_keys'] as const) {
      expect(tools[name].agent).toBe(false);
      await expect(callTool(name, { provider: 'openai' } as never, asModel)).rejects.toThrow(
        /not offered/,
      );
    }
  });
});

describe('facets', () => {
  const custom: Facet = {
    id: 'seen',
    pack: 'mine',
    title: 'Seen',
    kind: 'flag',
    instructions: 'Q?',
    applies_to: [],
    weight: 1,
  };

  test('saves, lists as custom, and deletes a custom facet', async () => {
    await callTool('save_facet', custom, ctx);
    const listed = (await callTool('list_facets', {}, ctx)).find((facet) => facet.id === 'seen');
    expect(listed).toMatchObject({ custom: true, enabled: false, pack: 'mine' });
    await callTool('delete_facet', { id: 'seen' }, ctx);
    expect((await callTool('list_facets', {}, ctx)).some((facet) => facet.id === 'seen')).toBe(
      false,
    );
  });

  test('refuses an invalid facet, and deleting a preset', async () => {
    await expect(callTool('save_facet', { ...custom, id: 'Bad Id' }, ctx)).rejects.toThrow(
      UserError,
    );
    await expect(callTool('delete_facet', { id: 'doc-type' }, ctx)).rejects.toThrow('not a custom');
    await expect(callTool('delete_facet', { id: '../x' }, ctx)).rejects.toThrow(UserError);
  });

  test('set_enabled turns packs and facets on and off, and saves the choice', async () => {
    expect(await enabled('invoice-state')).toBe(false);
    await callTool('set_enabled', { ids: ['finance'], enabled: true }, ctx);
    expect(await enabled('invoice-state')).toBe(true);
    await callTool('set_enabled', { ids: ['invoice-state'], enabled: false }, ctx);
    expect(await enabled('invoice-state')).toBe(false);
    expect(await enabled('amount')).toBe(true);
    expect(await readFile(paths.configFile(), 'utf8')).toContain('invoice-state');
    await expect(callTool('set_enabled', { ids: ['nope'], enabled: true }, ctx)).rejects.toThrow(
      'no facet',
    );
  });
});

describe('reports and config', () => {
  test('cleanup finds near-duplicates, one-file tags and over-broad tags', async () => {
    const names = Array.from({ length: 10 }, (_, index) => `${index}.txt`);
    for (const name of names) {
      await writeFile(at(name), name);
      await writeTags(at(name), ['doc-type:document']);
    }
    await writeTags(at('0.txt'), ['doc-type:document', 'project:acme', 'project:acme-corp']);
    await scanAll();
    const report = await callTool('cleanup_report', {}, ctx);
    expect(report.near_duplicates).toEqual([
      { tags: ['project:acme', 'project:acme-corp'], files: 2 },
    ]);
    expect(report.single_use.map((row) => row.tag)).toEqual(['project:acme', 'project:acme-corp']);
    expect(report.over_broad.map((row) => row.tag)).toEqual(['doc-type:document']);
  });

  test('doctor fails with no key, and reports volumes', async () => {
    const checks = await callTool('doctor', {}, ctx);
    expect(checks.find((check) => check.name === 'key')).toMatchObject({ ok: false });
    expect(checks.find((check) => check.name === 'volume')).toMatchObject({ ok: true });
    const optional = checks.filter((check) => check.name.startsWith('optional:'));
    expect(optional.every((check) => check.ok)).toBe(true);
    await callTool('set_api_key', { provider: 'openai', key: 'k' }, ctx);
    const withKey = await callTool('doctor', {}, ctx);
    expect(withKey.find((check) => check.name === 'key')).toMatchObject({
      ok: true,
      detail: 'openai key present (file)',
    });
  });

  test('get_config says where things live', async () => {
    const { paths: where } = await callTool('get_config', {}, ctx);
    expect(where.config).toBe(paths.configFile());
  });

  test('set_config validates, saves and reaches the running context', async () => {
    await callTool('set_config', { thresholds: { apply: 0.9 } }, ctx);
    expect(ctx.config.thresholds.apply).toBe(0.9);
    await expect(callTool('set_config', { nope: 1 }, ctx)).rejects.toThrow('unknown key');
    const { config, schema } = await callTool('get_config', {}, ctx);
    expect(config.thresholds).toMatchObject({ apply: 0.9 });
    expect(schema).toHaveProperty('properties');
  });

  test('language is saved globally while the detected PC language stays out of config', async () => {
    await callTool('set_config', { language: 'ja' }, ctx);
    const result = await callTool('get_config', {}, ctx);
    expect(result.config.language).toBe('ja');
    expect(['en', 'ja', 'zh-CN']).toContain(result.system_language);
    expect(result.config).not.toHaveProperty('system_language');
    await expect(callTool('set_config', { system_language: 'en' }, ctx)).rejects.toThrow(UserError);
    expect(tools.get_config.agent).toBe(false);
    expect(tools.set_config.agent).toBe(false);
  });

  test('reveal_file refuses an id it cannot serve, and never takes a path', async () => {
    await expect(callTool('reveal_file', { id: 999 }, ctx)).rejects.toThrow('not in a library');
    await expect(callTool('reveal_file', { path: '/x' } as never, ctx)).rejects.toThrow(UserError);
  });
});

/** A scanned file, with nothing spawned so far. */
const add = async (name: string) => {
  await writeFile(at(name), 'x');
  await scanAll();
  vi.mocked(spawn).mockClear();
  return idOf(name);
};

describe('open_file', () => {
  test.each(['plan.docx', 'budget.xlsx', 'deck.pptx', 'scan.PDF', 'photo.jpg', 'a.exe.pdf'])(
    'hands %s to the OS, as one argument and no shell',
    async (name) => {
      await callTool('open_file', { id: await add(name) }, ctx);
      // `explorer` takes the path quoted, still as one argument.
      const arg = process.platform === 'win32' ? `"${at(name)}"` : at(name);
      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([arg]);
    },
  );

  test.each([
    'a.app',
    'a.command',
    'a.EXE',
    'a.lnk',
    'a.sh',
    'a.jar',
    'a.webloc',
    'noext',
    'a.exe.',
  ])('refuses %s', async (name) => {
    const id = await add(name);
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('could run a program');
    expect(spawn).not.toHaveBeenCalled();
  });

  test.runIf(process.platform !== 'win32')('refuses a file with an execute bit', async () => {
    const id = await add('run.txt');
    await chmod(at('run.txt'), 0o755);
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('could run a program');
    expect(spawn).not.toHaveBeenCalled();
  });

  test.runIf(process.platform !== 'win32')(
    'opens a real document on a drive that marks every file executable',
    async () => {
      await copyFile(fixture('budget.xlsx'), at('budget.xlsx'));
      await chmod(at('budget.xlsx'), 0o777);
      await scanAll();
      await callTool('open_file', { id: idOf('budget.xlsx') }, ctx);
      expect(spawn).toHaveBeenCalled();
    },
  );

  test.each([
    ['darwin', 'open', (path: string) => [path]],
    ['linux', 'xdg-open', (path: string) => [path]],
    ['win32', 'explorer', (path: string) => [`"${path}"`]],
  ])('on %s it calls %s', async (platform, command, args) => {
    const id = await add('a, b.docx');
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: platform });
    await callTool('open_file', { id }, ctx).finally(() =>
      Object.defineProperty(process, 'platform', { value: real }),
    );
    expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([command, args(at('a, b.docx'))]);
  });

  test('refuses a link planted after the scan, and a file that has gone', async () => {
    const id = await add('plan.docx');
    await rm(at('plan.docx'));
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('not in a library');
    await symlink('/bin/sh', at('plan.docx'));
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('not in a library');
    expect(spawn).not.toHaveBeenCalled();
  });

  test.runIf(process.platform !== 'win32')('says when no app can open it', async () => {
    const id = await add('plan.docx');
    exitCode = 1;
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('No app');
    exitCode = 0;
  });

  test('takes an id, never a path, and stays out of reach of models', async () => {
    await expect(callTool('open_file', { path: '/x' } as never, ctx)).rejects.toThrow(UserError);
    await expect(callTool('open_file', { id: 999 }, ctx)).rejects.toThrow('not in a library');
    expect(tools.open_file.agent).toBe(false);
    await expect(callTool('open_file', { id: 1 }, as('mcp', true))).rejects.toThrow(UserError);
  });
});
