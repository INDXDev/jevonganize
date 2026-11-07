/** Commands over the topic catalog and proper names. Thin: tools do the work. */
import { t } from './i18n/index.ts';
import { sep } from 'node:path';
import type { Command } from 'commander';
import { indexedPath } from '../core/config.ts';
import type { Context } from '../core/tools.ts';
import type { TopicPicks } from '../types.ts';
import { askEnvConsent } from './settings.ts';
import {
  callTool,
  command,
  count,
  follow,
  type JsonFlag,
  note,
  out,
  outJson,
  shown,
  withContext,
} from './shared.ts';

interface PickFlags extends JsonFlag {
  limit?: number;
  dryRun?: boolean;
}

/** Indexes a folder that is in no library yet, so a command can start from where a person stands. */
async function indexed(path: string, ctx: Context): Promise<string> {
  const folder = indexedPath(path);
  const libraries = await callTool('list_libraries', {}, ctx);
  const inside = libraries.some((lib) => folder === lib.path || folder.startsWith(lib.path + sep));
  if (inside) return folder;
  await callTool('add_library', { path: folder }, ctx);
  await follow(ctx, await callTool('scan', { path: folder }, ctx));
  return folder;
}

/** Asks the model for topics, and makes them values of `topic` unless this is a dry run. */
export async function adoptTopics(
  folder: string,
  ctx: Context,
  { limit, dryRun }: PickFlags = {},
): Promise<TopicPicks> {
  await askEnvConsent(ctx.config.provider.name);
  const input = { query: { folder }, ...(limit !== undefined && { limit }) };
  const picks = await callTool('pick_topics', input, ctx);
  if (dryRun) return picks;
  for (const { value } of picks.topics) {
    await callTool('set_vocabulary', { facet: 'topic', value, state: 'active' }, ctx);
  }
  return picks;
}

/** One line on what a pick found and cost. */
export function picksLine({ topics, files, tokens, cost_usd }: TopicPicks): string {
  const cost = cost_usd === null ? '' : ` ($${cost_usd.toFixed(3)})`;
  return t('{topics} topics from {files} file names, {tokens} tokens{cost}', {
    topics: count(topics.length),
    files: count(files),
    tokens: count(tokens),
    cost,
  });
}

async function runPick(path: string, flags: PickFlags) {
  await withContext(flags, async (ctx) => {
    const picks = await adoptTopics(await indexed(path, ctx), ctx, flags);
    if (flags.json) return outJson(picks);
    for (const { value, probability } of picks.topics) {
      out(`  ${probability.toFixed(2)}  topic:${value}`);
    }
    note(picksLine(picks));
    return note(
      flags.dryRun
        ? t('Nothing was changed.')
        : t('Next: jevonganize organize {path}', { path: shown(path) }),
    );
  });
}

async function runSearch(text: string, flags: JsonFlag & { limit?: number }) {
  await withContext(flags, async (ctx) => {
    const input = { text, ...(flags.limit !== undefined && { limit: flags.limit }) };
    const values = await callTool('search_catalog', input, ctx);
    if (flags.json) return outJson(values);
    for (const value of values) out(`  topic:${value}`);
    return undefined;
  });
}

async function runAdd(values: string[], flags: JsonFlag) {
  await withContext(flags, async (ctx) => {
    for (const value of values) {
      await callTool('set_vocabulary', { facet: 'topic', value, state: 'active' }, ctx);
    }
    if (flags.json) return outJson(values);
    return out(t('Added {count} topics.', { count: count(values.length) }));
  });
}

async function runAddName(kind: string, name: string, flags: JsonFlag) {
  await withContext(flags, async (ctx) => {
    await callTool(
      'set_vocabulary',
      { facet: 'entity', value: `${kind}/${name}`, state: 'active' },
      ctx,
    );
    if (flags.json) return outJson({ kind, name });
    return out(t('Added. The next organize looks for it in every file.'));
  });
}

/** Adds `topics` and `names`. */
export function addCatalogCommands(program: Command): void {
  const topics = program.command('topics').description(t('Use the built-in topic catalog'));
  command(topics, 'pick [path]', t('Let the model choose topics from file names, and add them'))
    .option('--limit <n>', t('At most this many'), Number)
    .option('--dry-run', t('Print the picks and change nothing'))
    .action((path: string | undefined, flags: PickFlags) => runPick(path ?? '.', flags));
  command(topics, 'search <text>', t('Find topics in the catalog. Free and local'))
    .option('--limit <n>', t('At most this many'), Number)
    .action(runSearch);
  command(topics, 'add <values...>', t('Add catalog topics by hand')).action(runAdd);

  const names = program.command('names').description(t('Manage proper names'));
  command(names, 'add <kind> <name>', t('Register a proper name to look for')).action(runAddName);
}
