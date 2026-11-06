import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { paths, UserError } from '../src/core/config.ts';
import { writeTags } from '../src/core/tags.ts';
import { callTool, tools } from '../src/core/tools.ts';
import type { Facet } from '../src/types.ts';
import { as, at, ctx, scanAll, setupToolContext } from './tools-helpers.ts';

setupToolContext();

const removeKey = () => callTool('remove_api_key', { provider: 'openai' }, ctx);

const enabled = async (id: string) =>
  (await callTool('list_facets', {}, ctx)).find((facet) => facet.id === id)?.enabled;

describe('keys', () => {
  test('keys are listed and removed without ever being returned', async () => {
    await callTool('set_api_key', { provider: 'openai', key: 'sk-secret' }, ctx);
    const listed = await callTool('list_keys', {}, ctx);
    expect(listed.keys).toContainEqual({ provider: 'openai', source: 'file' });
    expect(listed.env_allowed).toBeNull();
    expect(JSON.stringify(listed)).not.toContain('sk-secret');
    expect(await removeKey()).toEqual({ removed: true });
    expect(await removeKey()).toEqual({ removed: false });
    await callTool('set_env_keys', { allowed: false }, ctx);
    expect((await callTool('list_keys', {}, ctx)).env_allowed).toBe(false);
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
