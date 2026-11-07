import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { paths, UserError } from '../src/core/config.ts';
import { callTool, tools } from '../src/core/tools.ts';
import type { Facet } from '../src/types.ts';
import { as, ctx, setupToolContext } from './tools-helpers.ts';

setupToolContext();

const listKeys = () => callTool('list_keys', {}, ctx);
const removeOpenaiKey = () => callTool('remove_api_key', { provider: 'openai' }, ctx);
const allowEnvKeys = (allowed: boolean) => callTool('set_env_keys', { allowed }, ctx);

/** Whether the facet or pack with this id is enabled, as `list_facets` reports it. */
const isEnabled = async (id: string) =>
  (await callTool('list_facets', {}, ctx)).find((facet) => facet.id === id)?.enabled;

/** The result of the doctor check with this name. */
const doctorCheck = async (name: string) =>
  (await callTool('doctor', {}, ctx)).find((check) => check.name === name);

/** A valid custom facet, in a pack of its own. */
const CUSTOM_FACET: Facet = {
  id: 'seen',
  pack: 'mine',
  title: 'Seen',
  kind: 'flag',
  instructions: 'Q?',
  applies_to: [],
  weight: 1,
};

describe('keys', () => {
  test('a stored key is listed by provider and source, never by value', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await callTool('set_api_key', { provider: 'openai', key: 'sk-secret' }, ctx);
    const listed = await listKeys();
    expect(listed.keys).toContainEqual({ provider: 'openai', source: 'file', in_env: false });
    expect(listed.env_allowed).toBeNull();
    expect(JSON.stringify(listed)).not.toContain('sk-secret');
    vi.unstubAllEnvs();
  });

  test('removing a key says whether there was one', async () => {
    await callTool('set_api_key', { provider: 'openai', key: 'sk-secret' }, ctx);
    expect(await removeOpenaiKey()).toEqual({ removed: true });
    expect(await removeOpenaiKey()).toEqual({ removed: false });
  });

  test('the choice about environment keys is saved and listed', async () => {
    await allowEnvKeys(false);
    expect((await listKeys()).env_allowed).toBe(false);
  });

  test('a key in the environment is reported as present, and unused until allowed', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-env-secret');
    const listed = await listKeys();
    expect(listed.keys).toContainEqual({ provider: 'openai', source: null, in_env: true });
    expect(JSON.stringify(listed)).not.toContain('sk-env-secret');

    await allowEnvKeys(true);
    const allowed = await listKeys();
    expect(allowed.keys).toContainEqual({ provider: 'openai', source: 'env', in_env: true });
    await allowEnvKeys(false);
    vi.unstubAllEnvs();
  });

  test.each(['list_keys', 'remove_api_key', 'set_env_keys'] as const)(
    '%s stays out of reach of models',
    async (name) => {
      expect(tools[name].agent).toBe(false);
      const asModel = as('mcp', true);
      await expect(callTool(name, { provider: 'openai' } as never, asModel)).rejects.toThrow(
        /not offered/,
      );
    },
  );
});

describe('facets', () => {
  test('saves, lists as custom, and deletes a custom facet', async () => {
    await callTool('save_facet', CUSTOM_FACET, ctx);
    const facets = await callTool('list_facets', {}, ctx);
    const saved = facets.find((facet) => facet.id === 'seen');
    expect(saved).toMatchObject({ custom: true, enabled: false, pack: 'mine' });

    await callTool('delete_facet', { id: 'seen' }, ctx);
    const afterDelete = await callTool('list_facets', {}, ctx);
    expect(afterDelete.some((facet) => facet.id === 'seen')).toBe(false);
  });

  test('refuses an invalid facet id', async () => {
    const badId = { ...CUSTOM_FACET, id: 'Bad Id' };
    await expect(callTool('save_facet', badId, ctx)).rejects.toThrow(UserError);
    await expect(callTool('delete_facet', { id: '../x' }, ctx)).rejects.toThrow(UserError);
  });

  test('refuses to delete a preset', async () => {
    await expect(callTool('delete_facet', { id: 'doc-type' }, ctx)).rejects.toThrow('not a custom');
  });

  test('set_enabled turns packs and facets on and off, and saves the choice', async () => {
    expect(await isEnabled('invoice-state')).toBe(false);
    await callTool('set_enabled', { ids: ['finance'], enabled: true }, ctx);
    expect(await isEnabled('invoice-state')).toBe(true);

    await callTool('set_enabled', { ids: ['invoice-state'], enabled: false }, ctx);
    expect(await isEnabled('invoice-state')).toBe(false);
    expect(await isEnabled('amount')).toBe(true);
    expect(await readFile(paths.configFile(), 'utf8')).toContain('invoice-state');
  });

  test('set_enabled refuses an unknown id', async () => {
    const unknown = callTool('set_enabled', { ids: ['nope'], enabled: true }, ctx);
    await expect(unknown).rejects.toThrow('no facet');
  });
});

describe('doctor and reveal_file', () => {
  test('doctor fails with no key, and reports volumes and optional tools', async () => {
    const checks = await callTool('doctor', {}, ctx);
    expect(checks.find((check) => check.name === 'key')).toMatchObject({ ok: false });
    expect(checks.find((check) => check.name === 'volume')).toMatchObject({ ok: true });
    const optional = checks.filter((check) => check.name.startsWith('optional:'));
    expect(optional.every((check) => check.ok)).toBe(true);
  });

  test('doctor passes the key check once a key is stored', async () => {
    await callTool('set_api_key', { provider: 'openai', key: 'k' }, ctx);
    expect(await doctorCheck('key')).toMatchObject({
      ok: true,
      detail: 'openai key present (file)',
    });
  });

  test('reveal_file refuses an id it cannot serve, and never takes a path', async () => {
    await expect(callTool('reveal_file', { id: 999 }, ctx)).rejects.toThrow('not in a library');
    await expect(callTool('reveal_file', { path: '/x' } as never, ctx)).rejects.toThrow(UserError);
  });
});

describe('config', () => {
  test('get_config says where things live', async () => {
    const { paths: where } = await callTool('get_config', {}, ctx);
    expect(where.config).toBe(paths.configFile());
  });

  test('set_config saves and reaches the running context', async () => {
    await callTool('set_config', { thresholds: { apply: 0.9 } }, ctx);
    expect(ctx.config.thresholds.apply).toBe(0.9);
    const { config, schema } = await callTool('get_config', {}, ctx);
    expect(config.thresholds).toMatchObject({ apply: 0.9 });
    expect(schema).toHaveProperty('properties');
  });

  test('set_config refuses an unknown key', async () => {
    await expect(callTool('set_config', { nope: 1 }, ctx)).rejects.toThrow('unknown key');
  });

  test('language is saved globally while the detected PC language stays out of config', async () => {
    await callTool('set_config', { language: 'ja' }, ctx);
    const result = await callTool('get_config', {}, ctx);
    expect(result.config.language).toBe('ja');
    expect(['en', 'ja', 'zh-CN']).toContain(result.system_language);
    expect(result.config).not.toHaveProperty('system_language');
    await expect(callTool('set_config', { system_language: 'en' }, ctx)).rejects.toThrow(UserError);
  });

  test('config stays out of reach of models', () => {
    expect(tools.get_config.agent).toBe(false);
    expect(tools.set_config.agent).toBe(false);
  });
});
