/**
 * The config file: its schema, reading and writing it, and the errors and file helpers everything
 * else shares. Settings live only in the user's config, never in a folder, so a file someone
 * unpacked cannot plant one. The tables the schema is built from are in config-sections.ts.
 */
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse, stringify, TomlError } from 'smol-toml';
import { z } from 'zod';
import {
  budgetSchema,
  DEFAULT_PIPELINE,
  facetsSchema,
  providerSchema,
  tagColorSchema,
  thresholdsSchema,
  viewSchema,
  watchSchema,
} from './config-sections.ts';
import { ifExists, paths } from './paths.ts';

// Re-exported because nearly every module that reads config also needs these two.
export { ifExists, paths };

/** An error the user can fix. Anything else is reported as a bug. */
export class UserError extends Error {}

/** The text of anything thrown. */
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The files `config path` prints and Settings shows. */
export const locations = () => ({
  config: paths.configFile(),
  data: paths.database(),
  cache: paths.thumbnails(),
});

/**
 * A path as the index holds it, for comparing with stored paths: its real path. `native`, because
 * only that also expands Windows 8.3 short names and fixes a drive's or file's letter case.
 */
// shortcut: a path that is gone is only resolved, so a short name to a gone file misses its row.
export function indexedPath(path: string): string {
  try {
    return realpathSync.native(resolve(path));
  } catch {
    return resolve(path);
  }
}

/** The whole config file. The settings form is generated from this schema's JSON Schema. */
export const configSchema = z.strictObject({
  language: z
    .enum(['system', 'en', 'ja', 'zh-CN'])
    .default('system')
    .describe('Interface language: system default, English, Japanese or Simplified Chinese'),
  port: z
    .int()
    .min(1024)
    .max(65535)
    .default(48620)
    .describe('Local server port. The next free port is used if this one is taken'),
  concurrency: z.int().min(1).max(64).default(8).describe('Maximum parallel model calls'),
  max_tags: z
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Hard cap of tags per file, counting tags a person added'),
  fiscal_year_start: z
    .int()
    .min(1)
    .max(12)
    .default(4)
    .describe('First month of the fiscal year, for fiscal-year tags'),
  exclude: z
    .array(z.string())
    .default(['node_modules', '.git', '*.tmp', '.DS_Store', '._*', 'Thumbs.db']),
  send_images: z
    .boolean()
    .default(true)
    .describe('Off keeps every image on this machine, including rendered PDF pages'),
  tag_colors: z
    .record(z.string(), tagColorSchema)
    .default({})
    .describe('Colours by tag or by facet. Anything not named here gets its colour from its facet'),
  view: viewSchema.prefault({}),
  provider: providerSchema.default({ name: 'openai', model: 'gpt-6-luna' }),
  profiles: z.record(z.string(), providerSchema).default({}),
  chat: providerSchema.default({ name: 'openai', model: 'gpt-6-luna' }),
  ner: providerSchema
    .default({ name: 'openai', model: 'gpt-5.4-mini' })
    .describe('The light text model that reads proper names out of files'),
  facets: facetsSchema.prefault({}),
  thresholds: thresholdsSchema.prefault({}),
  budget: budgetSchema.prefault({}),
  pipeline: z
    .array(z.strictObject({ match: z.string(), use: z.array(z.string()).min(1) }))
    .default(DEFAULT_PIPELINE),
  watch: watchSchema.prefault({}),
});

/** The config, with every default filled in. */
export type Config = z.infer<typeof configSchema>;
/** `[budget]`, which extractors read. */
export type Budget = Config['budget'];
/** A colour a tag can have. */
export type TagColor = z.infer<typeof tagColorSchema>;
/** `[view]`, which the UI reads. */
export type ViewOptions = Config['view'];

/** True for a TOML table or any other plain object, but not for an array. */
export function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Creates a file and flushes it to disk. The `wx` flag refuses anything already there. */
async function writeAndSync(file: string, data: string, mode: number): Promise<void> {
  const handle = await open(file, 'wx', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Replaces a file in one step, so readers never see a partial write and a planted symlink is
 * replaced rather than followed. Keeps the existing mode unless `mode` is given.
 */
export async function writeFileAtomic(file: string, data: string, mode?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const current = await ifExists(stat(file));
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeAndSync(temp, data, mode ?? current?.mode ?? 0o644);
    if (mode !== undefined) await chmod(temp, mode); // the umask may have narrowed it
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Reads a text file, refusing anything that would never end, such as a device or pipe. */
export async function readRegularFile(file: string): Promise<string> {
  if (!(await stat(file)).isFile()) throw new UserError(`${file} is not a regular file`);
  return readFile(file, 'utf8');
}

/** Parses TOML, reporting a syntax error as a `UserError` that names the file. */
export function parseToml(text: string, file: string): Record<string, unknown> {
  try {
    return parse(text);
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    // TomlError.message quotes the offending line, which may contain a key.
    throw new UserError(`${file}: invalid TOML at line ${error.line}, column ${error.column}`);
  }
}

/** One validation issue as text, by key path. An unknown-keys issue gives a line per key. */
function issueProblems(issue: z.core.$ZodIssue): string[] {
  if (issue.code !== 'unrecognized_keys') return [`${issue.path.join('.')}: ${issue.message}`];
  return issue.keys.map((key) => `${[...issue.path, key].join('.')}: unknown key`);
}

/** Validates a value, reporting every problem by key path in one `UserError`. */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown, source: string) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.flatMap(issueProblems);
  throw new UserError(`${source}: ${problems.join('; ')}`);
}

/** Merges `layer` over `base`, table by table. Arrays and other values replace. */
export function mergeTables(
  base: Record<string, unknown>,
  layer: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    const current = merged[key];
    merged[key] = isTable(current) && isTable(value) ? mergeTables(current, value) : value;
  }
  return merged;
}

/** The config file as written, without defaults: `{}` when there is none. */
async function readConfigFile(): Promise<Record<string, unknown>> {
  const file = paths.configFile();
  const text = await ifExists(readRegularFile(file));
  return text === undefined ? {} : parseToml(text, file);
}

/** Loads the config. A missing file gives the defaults. */
export async function loadConfig(): Promise<Config> {
  return parseWith(configSchema, await readConfigFile(), paths.configFile());
}

/** Merges a partial config into the file, keeping only what the user set. */
export async function saveConfig(change: Record<string, unknown>): Promise<Config> {
  const merged = mergeTables(await readConfigFile(), change);
  const config = parseWith(configSchema, merged, 'config');
  await writeFileAtomic(paths.configFile(), stringify(merged));
  return config;
}

/** The JSON Schema behind the settings form. */
export const configJsonSchema = () => z.toJSONSchema(configSchema, { io: 'input' });
