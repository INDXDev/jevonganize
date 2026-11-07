/** `setup`: key, folder, packs, then a scan and the cost of a first run. Writes no tags. */
import { t } from './i18n/index.ts';
import { homedir } from 'node:os';
import { cancel, multiselect, text } from '@clack/prompts';
import type { Command } from 'commander';
import { indexedPath, UserError } from '../core/config.ts';
import { keySource } from '../core/credentials.ts';
import type { Context } from '../core/tools.ts';
import type { ProviderName } from '../types.ts';
import { adoptTopics, picksLine } from './catalog.ts';
import { askEnvConsent, readKey } from './settings.ts';
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

const prompt = { output: process.stderr };
/** As the UI's first run, so a huge folder cannot run up a bill before anyone has seen one. */

function answered<T>(value: T): Exclude<T, symbol> {
  if (typeof value !== 'symbol') return value as Exclude<T, symbol>;
  cancel(t('Setup cancelled.'), prompt);
  throw new UserError(t('Setup cancelled'));
}

async function chooseKey(provider: ProviderName, ctx: Context, yes: boolean): Promise<void> {
  await askEnvConsent(provider);
  const stored = (await keySource(provider)) !== null;
  // Without `--yes` a key can wait: scanning and browsing work with none.
  if (stored && process.stdin.isTTY) return;
  const key = await readKey(t('{provider} API key (Enter to skip)', { provider }));
  if (key) await callTool('set_api_key', { provider, key }, ctx);
  else if (yes && !stored)
    throw new UserError(t('No key for {provider}. Pipe one to stdin', { provider }));
}

async function choosePacks(flags: SetupFlags, ctx: Context): Promise<void> {
  const facets = await callTool('list_facets', {}, ctx);
  const packs = [...new Set(facets.map((facet) => facet.pack))];
  const enabled = packs.filter((pack) => ctx.config.facets.enabled.includes(pack));
  const chosen =
    flags.packs ??
    (flags.yes
      ? enabled
      : answered(
          await multiselect({
            ...prompt,
            message: t('Packs'),
            options: packs.map((value) => ({ value })),
            initialValues: enabled,
            required: true,
          }),
        ));
  await callTool('set_enabled', { ids: chosen, enabled: true }, ctx);
  const rest = packs.filter((pack) => !chosen.includes(pack) && enabled.includes(pack));
  if (rest.length > 0) await callTool('set_enabled', { ids: rest, enabled: false }, ctx);
}

async function runSetup(flags: SetupFlags) {
  if (flags.yes && !flags.folder) throw new UserError(t('--yes needs --folder'));
  if (!flags.yes && !process.stdin.isTTY)
    throw new UserError(t('setup needs a terminal, or --yes'));
  await withContext(flags, async (ctx) => {
    await chooseKey(flags.provider ?? ctx.config.provider.name, ctx, Boolean(flags.yes));
    const folder =
      flags.folder ??
      answered(
        await text({ ...prompt, message: t('Folder to organize'), placeholder: '~/Downloads' }),
      );
    const path = indexedPath(folder.replace(/^~(?=$|[\\/])/, homedir()));
    await callTool('add_library', { path }, ctx);
    await choosePacks(flags, ctx);
    const final = await follow(ctx, await callTool('scan', { path }, ctx));
    const wanted = flags.topics ?? !flags.yes;
    if (wanted && (await keySource(ctx.config.provider.name)) !== null) {
      note(picksLine(await adoptTopics(path, ctx)));
    }
    const estimate = await callTool('estimate', { query: { folder: path } }, ctx);
    if (flags.json) return outJson(estimate);
    out(
      t('Scanned {count} files in {path}.', { count: final.scan?.files ?? 0, path: shown(path) }),
    );
    out(costLine(estimate));
    return out(t('Next: jevonganize organize {path} --dry-run', { path: shown(path) }));
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
