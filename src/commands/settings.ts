/** Commands over settings: facets, config, auth, doctor. */
import { t, keySourceLabel } from './i18n/index.ts';
import { styleText } from 'node:util';
import type { Command } from 'commander';
import { UserError } from '../core/config.ts';
import { KEY_ENV } from '../core/credentials.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Check, FacetInfo, ProviderName } from '../types.ts';
import { addConfigCommands } from './config.ts';
import { readKey } from './prompts.ts';
import { callTool, command, type JsonFlag, out, outJson, shown, withContext } from './shared.ts';

function providerNamed(name: string): ProviderName {
  if (!Object.hasOwn(KEY_ENV, name))
    throw new UserError(t('There is no provider named "{name}"', { name }));
  return name as ProviderName;
}

/** One line per pack, marked `*` when any of its facets is enabled. */
function printFacets(facets: FacetInfo[]): void {
  for (const [pack, members] of Map.groupBy(facets, (facet) => facet.pack)) {
    const mark = members.some((facet) => facet.enabled) ? '*' : ' ';
    const ids = members.map((facet) => facet.id).join(', ');
    out(`${mark} ${sanitizeLine(pack).padEnd(13)} ${sanitizeLine(ids)}`);
  }
}

function printFacet(facet: FacetInfo): void {
  out(
    t('{id}  ({kind}, pack {pack}{enabled})', {
      id: facet.id,
      kind: facet.kind,
      pack: facet.pack,
      enabled: facet.enabled ? t(', enabled') : '',
    }),
  );
  if (facet.instructions) out(facet.instructions);
  for (const [label, meaning] of Object.entries(facet.values ?? {})) out(`  ${label}: ${meaning}`);
  if (facet.levels) out(t('Levels: {levels}', { levels: facet.levels.join(', ') }));
  const types = facet.applies_to.join(', ') || t('every file');
  out(t('Applies to: {types}', { types }));
}

async function listFacets(flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const facets = await callTool('list_facets', {}, ctx);
    return flags.json ? outJson(facets) : printFacets(facets);
  });
}

async function showFacet(id: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const facet = (await callTool('list_facets', {}, ctx)).find((entry) => entry.id === id);
    if (!facet) throw new UserError(t('There is no facet named "{id}"', { id }));
    return flags.json ? outJson(facet) : printFacet(facet);
  });
}

const setFacets = (enabled: boolean) => async (ids: string[], flags: JsonFlag) => {
  await withContext(flags, async (ctx) => {
    await callTool('set_enabled', { ids, enabled }, ctx);
    if (flags.json) return outJson(null);
    const names = { ids: ids.map(sanitizeLine).join(', ') };
    return out(t(enabled ? 'Enabled {ids}.' : 'Disabled {ids}.', names));
  });
};

function addFacetCommands(program: Command): void {
  const facets = program.command('facets').description(t('List and enable facets'));
  command(facets, 'list', t('Packs and facets, with * on enabled ones')).action(listFacets);
  command(facets, 'show <id>', t('One facet')).action(showFacet);
  command(facets, 'enable <ids...>', t('Enable packs or facets')).action(setFacets(true));
  command(facets, 'disable <ids...>', t('Disable packs or facets')).action(setFacets(false));
}

async function authSet(name: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const key = await readKey(t('{name} API key', { name }));
    await callTool('set_api_key', { provider: providerNamed(name), key }, ctx);
    if (flags.json) return outJson(null);
    return out(t('Stored a key for {name}.', { name: sanitizeLine(name) }));
  });
}

async function authList(flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const { keys } = await callTool('list_keys', {}, ctx);
    if (flags.json) return outJson(keys);
    for (const row of keys) out(`${row.provider.padEnd(12)}${keySourceLabel(row.source)}`);
    return undefined;
  });
}

async function authRemove(name: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const provider = providerNamed(name);
    const { removed } = await callTool('remove_api_key', { provider }, ctx);
    if (flags.json) return outJson({ removed });
    const shownName = { name: sanitizeLine(name) };
    return out(t(removed ? 'Removed the key for {name}.' : 'No key stored for {name}.', shownName));
  });
}

async function authEnv(state: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    if (state !== 'on' && state !== 'off')
      throw new UserError(t('Use: auth env on, or auth env off'));
    await callTool('set_env_keys', { allowed: state === 'on' }, ctx);
    const { env_allowed: allowed } = await callTool('list_keys', {}, ctx);
    if (flags.json) return outJson({ allowed });
    return out(t(state === 'on' ? 'Environment keys are on.' : 'Environment keys are off.'));
  });
}

function addAuthCommands(program: Command): void {
  const auth = program.command('auth').description(t('Manage API keys'));
  command(auth, 'set <provider>', t('Store a key. Pipe it in for scripts')).action(authSet);
  command(auth, 'list', t('Each provider and where its key comes from')).action(authList);
  command(auth, 'remove <provider>', t('Delete a stored key')).action(authRemove);
  command(auth, 'env <state>', t('Allow or refuse keys from the environment: on or off')).action(
    authEnv,
  );
}

/** `note` for an optional tool, whatever its result, since a missing one breaks nothing. */
function checkLabel({ name, ok }: Check): string {
  if (name.startsWith('optional:')) return t('note');
  return ok ? t('ok') : t('FAIL');
}

async function runDoctor(flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const checks = await callTool('doctor', {}, ctx);
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
    if (flags.json) return outJson(checks);
    for (const check of checks) {
      const detail = check.name === 'volume' ? shown(check.detail) : sanitizeLine(check.detail);
      out(`${styleText(check.ok ? 'green' : 'red', checkLabel(check).padEnd(6))}${detail}`);
    }
    return undefined;
  });
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
