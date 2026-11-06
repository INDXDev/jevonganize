/** Paths, the config schema, and reading and writing the config file. */
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse, stringify, TomlError } from 'smol-toml';
import { z } from 'zod';
import { ifExists, paths } from './paths.ts';

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

const providerSchema = z.strictObject({
  name: z.enum(['openai', 'typesafe', 'gateway', 'cloudflare', 'openrouter', 'compatible', 'chat']),
  model: z.string().optional(),
  base_url: z.url().optional(),
  account_id: z.string().optional(),
});

const budgetSchema = z.strictObject({
  text_chars: z
    .int()
    .positive()
    .default(8000)
    .describe('Text sent per file: 75% from the start, 25% from the end'),
  pdf_pages: z.int().positive().default(10).describe('PDF pages read for text'),
  render_pages: z
    .int()
    .nonnegative()
    .default(2)
    .describe('Pages rendered to images when a PDF has little text'),
  thin_text_chars: z
    .int()
    .nonnegative()
    .default(200)
    .describe('Text per page below which a PDF counts as scanned'),
  images: z.int().nonnegative().default(2).describe('Images sent per file, from any source'),
  image_edge: z.int().positive().default(768).describe('Longest image edge in pixels'),
  sheets: z.int().positive().default(5).describe('Spreadsheet sheets read'),
  sheet_rows: z.int().positive().default(50).describe('Rows read per sheet'),
  zip_entries: z.int().positive().default(200).describe('Archive entry names read'),
  max_parse_mb: z
    .number()
    .positive()
    .default(200)
    .describe('Larger files skip parsers that read the whole file'),
  max_office_mb: z
    .number()
    .positive()
    .default(25)
    .describe('The same limit for Office files, which inflate in memory'),
  timeout_seconds: z.number().positive().default(30).describe('Time limit per file'),
});

const tagColorSchema = z.enum([
  'auto',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'gray',
]);

const viewSchema = z.strictObject({
  show_dotfiles: z
    .boolean()
    .default(false)
    .describe('Show files and folders whose names start with a dot'),
  include_subfolders: z
    .boolean()
    .default(true)
    .describe('Show everything under a folder. Off shows only what sits directly in it'),
  show_extensions: z.boolean().default(true).describe('Show file name extensions'),
  thumbnail_size: z
    .int()
    .min(64)
    .max(512)
    .default(160)
    .describe('Width of a grid tile in pixels, when grid_columns is 0'),
  grid_columns: z
    .int()
    .min(0)
    .max(12)
    .default(0)
    .describe('Tiles per row. 0 fits as many as thumbnail_size allows'),
  grid_spacing: z.int().min(0).max(48).default(10).describe('Space between tiles in pixels'),
  thumbnail_fit: z
    .enum(['cover', 'contain'])
    .default('cover')
    .describe('Cover fills the tile and crops. Contain shows the whole thumbnail'),
  grid_info: z
    .enum(['tags', 'kind', 'size', 'modified', 'none'])
    .default('tags')
    .describe('The line under a file name in the grid'),
  text_size: z.int().min(10).max(20).default(12).describe('File name size in pixels'),
  list_columns: z
    .array(z.enum(['tags', 'kind', 'size', 'modified', 'path']))
    .default(['tags', 'size', 'modified'])
    .describe('Columns of the list, after the name'),
  list_thumbnails: z.boolean().default(false).describe('Show thumbnails in the list, not icons'),
});

const facetsSchema = z.strictObject({
  enabled: z.array(z.string()).default(['core', 'time', 'sensitivity', 'media']),
  disabled: z.array(z.string()).default([]),
});

const thresholdsSchema = z.strictObject({
  apply: z
    .number()
    .min(0)
    .max(1)
    .default(0.85)
    .describe('Confidence at or above this joins the plan'),
  review: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe('Confidence at or above this goes to review. Lower is dropped'),
  estimated_to_review: z
    .boolean()
    .default(true)
    .describe('Answers without native probabilities never apply on their own'),
});

const watchSchema = z.strictObject({
  enabled: z.boolean().default(true),
  walk_minutes: z
    .number()
    .positive()
    .default(30)
    .describe('Minutes between full checks, which catch missed events'),
});

const pipelineStep = (match: string, ...use: string[]) => ({ match, use });

/** First match wins. Documented in docs/pipeline.md, which must stay in step with this. */
const DEFAULT_PIPELINE = [
  pipelineStep('application/pdf', 'pdf', 'pdf-render'),
  pipelineStep('image/hei*', 'heic', 'exif'),
  pipelineStep('image/svg+xml', 'text', 'image'),
  pipelineStep('image/*', 'image', 'exif', 'screenshot'),
  pipelineStep('audio/*', 'media'),
  pipelineStep('video/*', 'media', 'ffmpeg-frames'),
  pipelineStep('message/rfc822', 'eml'),
  pipelineStep('application/vnd.ms-outlook', 'msg'),
  pipelineStep('application/zip', 'zip'),
  pipelineStep('application/vnd.openxmlformats-*', 'office'),
  pipelineStep('application/vnd.oasis.*', 'office'),
  pipelineStep('application/rtf', 'office'),
  pipelineStep('application/epub+zip', 'office'),
  pipelineStep('text/html', 'office', 'text'),
  pipelineStep('application/msword', 'libreoffice'),
  pipelineStep('application/vnd.ms-excel', 'libreoffice'),
  pipelineStep('application/vnd.ms-powerpoint', 'libreoffice'),
  pipelineStep('text/*', 'text'),
  pipelineStep('*', 'text'),
];

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
  facets: facetsSchema.prefault({}),
  thresholds: thresholdsSchema.prefault({}),
  budget: budgetSchema.prefault({}),
  pipeline: z
    .array(z.strictObject({ match: z.string(), use: z.array(z.string()).min(1) }))
    .default(DEFAULT_PIPELINE),
  watch: watchSchema.prefault({}),
});

export type Config = z.infer<typeof configSchema>;
export type Budget = Config['budget'];
export type TagColor = z.infer<typeof tagColorSchema>;
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
