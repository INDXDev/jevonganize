/** `setup`: key, folder, packs, then a scan and the cost of a first run. Writes no tags. */
import { t } from './i18n/index.ts';
import { homedir } from 'node:os';
import { cancel, multiselect, text } from '@clack/prompts';
import type { Command } from 'commander';
import { indexedPath, UserError } from '../core/config.ts';
import { keySource } from '../core/credentials.ts';
import type { Context } from '../core/tools.ts';
import type { Estimate, ProviderName } from '../types.ts';
import { adoptTopics, picksLine } from './catalog.ts';
import { askEnvConsent, promptOutput, readKey } from './prompts.ts';
import {
  callTool,
  command,
  commaList,
  costLine,
  follow,
  type JsonFlag,
  note,
  out,
  outJson,
  shown,
  withContext,
} from './shared.ts';

interface SetupFlags extends JsonFlag {
  provider?: ProviderName;
  folder?: string;
  packs?: string[];
  yes?: boolean;
  /** Off with `--no-topics`. With `--yes`, it must be asked for. */
  topics?: boolean;
}

/** A prompt's answer. A cancelled prompt answers with a symbol, which ends setup. */
function answered<T>(value: T): Exclude<T, symbol> {
  if (typeof value !== 'symbol') return value as Exclude<T, symbol>;
  cancel(t('Setup cancelled.'), promptOutput);
  throw new UserError(t('Setup cancelled'));
}

const hasKey = async (provider: ProviderName) => (await keySource(provider)) !== null;

/** Reads a key unless a person at a terminal already has one stored. */
async function chooseKey(provider: ProviderName, ctx: Context, yes: boolean): Promise<void> {
  await askEnvConsent(provider);
  const isStored = await hasKey(provider);
  if (isStored && process.stdin.isTTY) return;
  const key = await readKey(t('{provider} API key (Enter to skip)', { provider }));
  if (key) {
    await callTool('set_api_key', { provider, key }, ctx);
    return;
  }
  // Without `--yes` a key can wait: scanning and browsing work with none.
  const mustHaveKey = yes && !isStored;
  if (mustHaveKey) throw new UserError(t('No key for {provider}. Pipe one to stdin', { provider }));
}

async function askForFolder(): Promise<string> {
  const message = t('Folder to organize');
  return answered(await text({ ...promptOutput, message, placeholder: '~/Downloads' }));
}

/** `--folder`, else what a person types, with a leading `~` as the home folder. */
async function chooseFolder(flags: SetupFlags): Promise<string> {
  const folder = flags.folder ?? (await askForFolder());
  const startsWithTilde = /^~(?=$|[\\/])/;
  return indexedPath(folder.replace(startsWithTilde, homedir()));
}

/** `--packs`, else the enabled packs with `--yes`, else what a person ticks. */
async function packsToEnable(flags: SetupFlags, packs: string[], enabled: string[]) {
  if (flags.packs) return flags.packs;
  if (flags.yes) return enabled;
  const ticked = await multiselect({
    ...promptOutput,
    message: t('Packs'),
    options: packs.map((value) => ({ value })),
    initialValues: enabled,
    required: true,
  });
  return answered(ticked);
}

async function choosePacks(flags: SetupFlags, ctx: Context): Promise<void> {
  const facets = await callTool('list_facets', {}, ctx);
  const packs = [...new Set(facets.map((facet) => facet.pack))];
  const enabled = packs.filter((pack) => ctx.config.facets.enabled.includes(pack));
  const chosen = await packsToEnable(flags, packs, enabled);
  await callTool('set_enabled', { ids: chosen, enabled: true }, ctx);
  const unchosen = packs.filter((pack) => !chosen.includes(pack) && enabled.includes(pack));
  if (unchosen.length > 0) await callTool('set_enabled', { ids: unchosen, enabled: false }, ctx);
}

/** Topics are chosen by default in a terminal, and with `--yes` only when asked for. */
async function chooseTopics(flags: SetupFlags, path: string, ctx: Context): Promise<void> {
  const wantsTopics = flags.topics ?? !flags.yes;
  if (!wantsTopics || !(await hasKey(ctx.config.provider.name))) return;
  note(picksLine(await adoptTopics(path, ctx)));
}

function printNextStep(scannedFiles: number, path: string, estimate: Estimate): void {
  out(t('Scanned {count} files in {path}.', { count: scannedFiles, path: shown(path) }));
  out(costLine(estimate));
  out(t('Next: jevonganize organize {path} --dry-run', { path: shown(path) }));
}

async function runSetup(flags: SetupFlags): Promise<void> {
  if (flags.yes && !flags.folder) throw new UserError(t('--yes needs --folder'));
  if (!flags.yes && !process.stdin.isTTY)
    throw new UserError(t('setup needs a terminal, or --yes'));
  await withContext(flags, async (ctx) => {
    await chooseKey(flags.provider ?? ctx.config.provider.name, ctx, Boolean(flags.yes));
    const path = await chooseFolder(flags);
    await callTool('add_library', { path }, ctx);
    await choosePacks(flags, ctx);
    const final = await follow(ctx, await callTool('scan', { path }, ctx));
    await chooseTopics(flags, path, ctx);
    const estimate = await callTool('estimate', { query: { folder: path } }, ctx);
    if (flags.json) return outJson(estimate);
    return printNextStep(final.scan?.files ?? 0, path, estimate);
  });
}

/** Adds `setup`. */
export function addSetupCommand(program: Command): void {
  command(program, 'setup', t('Ask for a key, a folder and packs, then scan'))
    .option('--provider <name>', t('Provider to set a key for'))
    .option('--folder <path>', t('Library to add'))
    .option('--packs <ids>', t('Comma-separated packs to enable'), commaList)
    .option('--yes', t('Ask nothing. Needs --folder'))
    .option('--topics', t('Choose topics, even with --yes'))
    .option('--no-topics', t('Skip choosing topics'))
    .action(runSetup);
}
