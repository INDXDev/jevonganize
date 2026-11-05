/** `setup`: key, folder, packs, then a scan and the cost of a first run. Writes no tags. */
import { homedir } from 'node:os';
import { cancel, multiselect, text } from '@clack/prompts';
import type { Command } from 'commander';
import { indexedPath, UserError } from '../core/config.ts';
import { keySource } from '../core/credentials.ts';
import { callTool, type Context } from '../core/tools.ts';
import type { ProviderName } from '../types.ts';
import { askEnvConsent, readKey } from './settings.ts';
import {
  command,
  commaList,
  costLine,
  follow,
  type JsonFlag,
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
}

const prompt = { output: process.stderr };

function answered<T>(value: T): Exclude<T, symbol> {
  if (typeof value !== 'symbol') return value as Exclude<T, symbol>;
  cancel('Setup cancelled.', prompt);
  throw new UserError('Setup cancelled');
}

async function chooseKey(provider: ProviderName, ctx: Context, yes: boolean): Promise<void> {
  await askEnvConsent(provider);
  const stored = (await keySource(provider)) !== null;
  // Without `--yes` a key can wait: scanning and browsing work with none.
  if (stored && process.stdin.isTTY) return;
  const key = await readKey(`${provider} API key (Enter to skip)`);
  if (key) await callTool('set_api_key', { provider, key }, ctx);
  else if (yes && !stored) throw new UserError(`No key for ${provider}. Pipe one to stdin`);
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
            message: 'Packs',
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
  if (flags.yes && !flags.folder) throw new UserError('--yes needs --folder');
  if (!flags.yes && !process.stdin.isTTY) throw new UserError('setup needs a terminal, or --yes');
  await withContext(flags, async (ctx) => {
    await chooseKey(flags.provider ?? ctx.config.provider.name, ctx, Boolean(flags.yes));
    const folder =
      flags.folder ??
      answered(
        await text({ ...prompt, message: 'Folder to organize', placeholder: '~/Downloads' }),
      );
    const path = indexedPath(folder.replace(/^~(?=$|[\\/])/, homedir()));
    await callTool('add_library', { path }, ctx);
    await choosePacks(flags, ctx);
    const final = await follow(ctx, await callTool('scan', { path }, ctx));
    const estimate = await callTool('estimate', { query: { folder: path } }, ctx);
    if (flags.json) return outJson(estimate);
    out(`Scanned ${final.scan?.files ?? 0} files in ${shown(path)}.`);
    out(costLine(estimate));
    return out(`Next: jevonganize organize ${shown(path)} --dry-run`);
  });
}

/** Adds `setup`. */
export function addSetupCommand(program: Command): void {
  command(program, 'setup', 'Ask for a key, a folder and packs, then scan')
    .option('--provider <name>', 'Provider to set a key for')
    .option('--folder <path>', 'Library to add')
    .option('--packs <ids>', 'Comma-separated packs to enable', commaList)
    .option('--yes', 'Ask nothing. Needs --folder')
    .action(runSetup);
}
