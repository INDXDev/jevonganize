/** Commands over settings: facets, config, auth, doctor. */
import { t, keySourceLabel } from './i18n/index.ts';
import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { styleText } from 'node:util';
import { confirm, isCancel, password } from '@clack/prompts';
import type { Command } from 'commander';
import { parse, stringify } from 'smol-toml';
import {
  configSchema,
  ifExists,
  isTable,
  locations,
  parseToml,
  parseWith,
  paths,
  readRegularFile,
  UserError,
  writeFileAtomic,
} from '../core/config.ts';
import { envKeyUnanswered, KEY_ENV, setEnvKeysAllowed } from '../core/credentials.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { FacetInfo, ProviderName } from '../types.ts';
import { callTool, command, type JsonFlag, out, outJson, shown, withContext } from './shared.ts';

const prompt = { output: process.stderr };

/** Asks once, in a terminal, whether a key in the environment may be used. The default is no. */
export async function askEnvConsent(provider: ProviderName): Promise<void> {
  if (!process.stdin.isTTY || !(await envKeyUnanswered(provider))) return;
  const message = t('{key} is set. Use keys from the environment?', { key: KEY_ENV[provider] });
  const answer = await confirm({
    ...prompt,
    message,
    initialValue: false,
    active: t('Yes'),
    inactive: t('No'),
  });
  await setEnvKeysAllowed(answer === true);
}

/** Reads a key: hidden in a terminal, and from stdin in a pipe, so it never lands in shell history. */
export async function readKey(label: string): Promise<string> {
  if (process.stdin.isTTY) {
    const value = await password({ ...prompt, message: label });
    return isCancel(value) ? '' : value;
  }
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text.trim();
}

function providerNamed(name: string): ProviderName {
  if (!Object.hasOwn(KEY_ENV, name))
    throw new UserError(t('There is no provider named "{name}"', { name }));
  return name as ProviderName;
}

function printFacets(facets: FacetInfo[]): void {
  for (const [pack, members] of Map.groupBy(facets, (facet) => facet.pack)) {
    const mark = members.some((facet) => facet.enabled) ? '*' : ' ';
    const ids = members.map((facet) => facet.id).join(', ');
    out(`${mark} ${sanitizeLine(pack).padEnd(13)} ${sanitizeLine(ids)}`);
  }
}

async function showFacet(id: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const facet = (await callTool('list_facets', {}, ctx)).find((entry) => entry.id === id);
    if (!facet) throw new UserError(t('There is no facet named "{id}"', { id }));
    if (flags.json) return outJson(facet);
    out(
      t('{id}  ({kind}, pack {pack}{enabled})', {
        id: facet.id,
        kind: facet.kind,
        pack: facet.pack,
        enabled: facet.enabled ? t(', enabled') : '',
      }),
    );
    if (facet.instructions) out(facet.instructions);
    for (const [label, meaning] of Object.entries(facet.values ?? {}))
      out(`  ${label}: ${meaning}`);
    if (facet.levels) out(t('Levels: {levels}', { levels: facet.levels.join(', ') }));
    return out(t('Applies to: {types}', { types: facet.applies_to.join(', ') || t('every file') }));
  });
}

const setFacets = (enabled: boolean) => async (ids: string[], flags: JsonFlag) => {
  await withContext(flags, async (ctx) => {
    await callTool('set_enabled', { ids, enabled }, ctx);
    if (flags.json) return outJson(null);
    return out(
      t(enabled ? 'Enabled {ids}.' : 'Disabled {ids}.', { ids: ids.map(sanitizeLine).join(', ') }),
    );
  });
};

function pick(config: Record<string, unknown>, key: string): unknown {
  let value: unknown = config;
  for (const part of key.split('.')) {
    if (!isTable(value) || !Object.hasOwn(value, part)) {
      throw new UserError(t('There is no config key "{key}"', { key }));
    }
    value = value[part];
  }
  return value;
}

/** A value as TOML, or a bare word as a string, so `provider.name openai` needs no quotes. */
function parseValue(text: string): unknown {
  try {
    return parse(`value = ${text}`).value;
  } catch {
    return text;
  }
}

const nested = (key: string, value: unknown) =>
  key
    .split('.')
    .toReversed()
    .reduce<unknown>((inner, part) => ({ [part]: inner }), value) as Record<string, unknown>;

const showValue = (value: unknown) =>
  isTable(value) ? stringify(value).trimEnd() : JSON.stringify(value);

async function configGet(key: string | undefined, flags: JsonFlag) {
  await withContext(flags, async (ctx) => {
    const result = await callTool('get_config', {}, ctx);
    if (flags.json) return outJson(result);
    return out(key === undefined ? stringify(result.config) : showValue(pick(result.config, key)));
  });
}

async function configSet(key: string, text: string, flags: JsonFlag) {
  await withContext(flags, async (ctx) => {
    const value = parseValue(text);
    const config = await callTool('set_config', nested(key, value), ctx);
    return flags.json ? outJson(config) : out(`${key} = ${showValue(value)}`);
  });
}

async function configEdit(): Promise<void> {
  const fallback = process.platform === 'win32' ? 'notepad' : 'vi';
  const [editor, ...args] = (process.env.VISUAL ?? process.env.EDITOR ?? fallback).split(' ');
  const file = paths.configFile();
  const draft = `${file}.edit.toml`;
  await writeFileAtomic(draft, (await ifExists(readRegularFile(file))) ?? '');
  // No shell. An $EDITOR with arguments is split on spaces.
  const { status, error } = spawnSync(editor ?? fallback, [...args, draft], { stdio: 'inherit' });
  if (error || status !== 0)
    throw new UserError(t('The editor did not finish. {draft} is kept', { draft }));
  const text = await readFile(draft, 'utf8');
  parseWith(configSchema, parseToml(text, draft), draft);
  await writeFileAtomic(file, text);
  await rm(draft);
}

async function authList(flags: JsonFlag) {
  await withContext(flags, async (ctx) => {
    const { keys } = await callTool('list_keys', {}, ctx);
    if (flags.json) return outJson(keys);
    for (const row of keys) out(`${row.provider.padEnd(12)}${keySourceLabel(row.source)}`);
    return undefined;
  });
}

async function runDoctor(flags: JsonFlag) {
  await withContext(flags, async (ctx) => {
    const checks = await callTool('doctor', {}, ctx);
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
    if (flags.json) return outJson(checks);
    for (const { name, ok, detail } of checks) {
      const label = t(name.startsWith('optional:') ? 'note' : ok ? 'ok' : 'FAIL').padEnd(6);
      const text = name === 'volume' ? shown(detail) : sanitizeLine(detail);
      out(`${styleText(ok ? 'green' : 'red', label)}${text}`);
    }
    return undefined;
  });
}

function addFacetCommands(program: Command): void {
  const facets = program.command('facets').description(t('List and enable facets'));
  command(facets, 'list', t('Packs and facets, with * on enabled ones')).action(
    async (flags: JsonFlag) =>
      withContext(flags, async (ctx) => {
        const all = await callTool('list_facets', {}, ctx);
        return flags.json ? outJson(all) : printFacets(all);
      }),
  );
  command(facets, 'show <id>', t('One facet')).action(showFacet);
  command(facets, 'enable <ids...>', t('Enable packs or facets')).action(setFacets(true));
  command(facets, 'disable <ids...>', t('Disable packs or facets')).action(setFacets(false));
}

function addConfigCommands(program: Command): void {
  const config = program.command('config').description(t('Read and change the config'));
  command(config, 'get [key]', t('Print the config, or one key')).action(configGet);
  command(config, 'set <key> <value>', t('Validate and save one key')).action(configSet);
  command(config, 'path', t('Print the config, data and cache paths')).action((flags: JsonFlag) => {
    const all = locations();
    if (flags.json) return outJson(all);
    return Object.values(all).forEach((path) => out(path));
  });
  command(config, 'edit', t('Open the config in $VISUAL or $EDITOR, then validate')).action(
    configEdit,
  );
}

function addAuthCommands(program: Command): void {
  const auth = program.command('auth').description(t('Manage API keys'));
  command(auth, 'set <provider>', t('Store a key. Pipe it in for scripts')).action(
    async (name: string, flags: JsonFlag) =>
      withContext(flags, async (ctx) => {
        const key = await readKey(t('{name} API key', { name }));
        await callTool('set_api_key', { provider: providerNamed(name), key }, ctx);
        return flags.json
          ? outJson(null)
          : out(t('Stored a key for {name}.', { name: sanitizeLine(name) }));
      }),
  );
  command(auth, 'list', t('Each provider and where its key comes from')).action(authList);
  command(auth, 'remove <provider>', t('Delete a stored key')).action(
    async (name: string, flags: JsonFlag) =>
      withContext(flags, async (ctx) => {
        const provider = providerNamed(name);
        const { removed } = await callTool('remove_api_key', { provider }, ctx);
        if (flags.json) return outJson({ removed });
        return out(
          t(removed ? 'Removed the key for {name}.' : 'No key stored for {name}.', {
            name: sanitizeLine(name),
          }),
        );
      }),
  );
  command(auth, 'env <state>', t('Allow or refuse keys from the environment: on or off')).action(
    async (state: string, flags: JsonFlag) =>
      withContext(flags, async (ctx) => {
        if (state !== 'on' && state !== 'off')
          throw new UserError(t('Use: auth env on, or auth env off'));
        await callTool('set_env_keys', { allowed: state === 'on' }, ctx);
        const { env_allowed: allowed } = await callTool('list_keys', {}, ctx);
        return flags.json
          ? outJson({ allowed })
          : out(t(state === 'on' ? 'Environment keys are on.' : 'Environment keys are off.'));
      }),
  );
}

/** Adds the commands of this file. */
export function addSettingsCommands(program: Command): void {
  addFacetCommands(program);
  addConfigCommands(program);
  addAuthCommands(program);
  command(program, 'doctor', t('Check the runtime, key, volumes and optional tools')).action(
    runDoctor,
  );
}
