/** `config`: read, change and edit the TOML config. The tools validate every change. */
import { t } from './i18n/index.ts';
import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
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
import { callTool, command, type JsonFlag, out, outJson, withContext } from './shared.ts';

/** The value at a dotted key such as `provider.name`. */
function valueAt(config: Record<string, unknown>, key: string): unknown {
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

/** `a.b` and 1 become `{ a: { b: 1 } }`, the partial config `set_config` takes. */
const nestUnderKey = (key: string, value: unknown) =>
  key
    .split('.')
    .toReversed()
    .reduce<unknown>((inner, part) => ({ [part]: inner }), value) as Record<string, unknown>;

const formatValue = (value: unknown) =>
  isTable(value) ? stringify(value).trimEnd() : JSON.stringify(value);

async function configGet(key: string | undefined, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const result = await callTool('get_config', {}, ctx);
    if (flags.json) return outJson(result);
    if (key === undefined) return out(stringify(result.config));
    return out(formatValue(valueAt(result.config, key)));
  });
}

async function configSet(key: string, text: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const value = parseValue(text);
    const config = await callTool('set_config', nestUnderKey(key, value), ctx);
    return flags.json ? outJson(config) : out(`${key} = ${formatValue(value)}`);
  });
}

/** The editor and its arguments. No shell, so an `$EDITOR` with arguments is split on spaces. */
function editorCommand(): [string, string[]] {
  const fallback = process.platform === 'win32' ? 'notepad' : 'vi';
  const [editor, ...args] = (process.env.VISUAL ?? process.env.EDITOR ?? fallback).split(' ');
  return [editor ?? fallback, args];
}

/** Edits a copy, and saves it over the config only once it validates. */
async function configEdit(): Promise<void> {
  const file = paths.configFile();
  const draft = `${file}.edit.toml`;
  await writeFileAtomic(draft, (await ifExists(readRegularFile(file))) ?? '');
  const [editor, args] = editorCommand();
  const { status, error } = spawnSync(editor, [...args, draft], { stdio: 'inherit' });
  if (error || status !== 0)
    throw new UserError(t('The editor did not finish. {draft} is kept', { draft }));
  const text = await readFile(draft, 'utf8');
  parseWith(configSchema, parseToml(text, draft), draft);
  await writeFileAtomic(file, text);
  await rm(draft);
}

function printLocations(flags: JsonFlag): void {
  const all = locations();
  if (flags.json) return outJson(all);
  return Object.values(all).forEach((path) => out(path));
}

/** Adds `config`. */
export function addConfigCommands(program: Command): void {
  const config = program.command('config').description(t('Read and change the config'));
  command(config, 'get [key]', t('Print the config, or one key')).action(configGet);
  command(config, 'set <key> <value>', t('Validate and save one key')).action(configSet);
  command(config, 'path', t('Print the config, data and cache paths')).action(printLocations);
  command(config, 'edit', t('Open the config in $VISUAL or $EDITOR, then validate')).action(
    configEdit,
  );
}
