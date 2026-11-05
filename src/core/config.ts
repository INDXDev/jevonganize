/** Paths, the config schema, and reading and writing the config file. */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import envPaths from 'env-paths';
import { parse, stringify, TomlError } from 'smol-toml';
import { z } from 'zod';

/** An error the user can fix. Anything else is reported as a bug. */
export class UserError extends Error {}

const dirs = envPaths('jevonganize', { suffix: '' });

/** Where everything lives. Tests point these elsewhere with `JEVONGANIZE_HOME`. */
export const paths = {
  configDir: () => home('config') ?? dirs.config,
  configFile: () => join(paths.configDir(), 'config.toml'),
  credentialsFile: () => join(paths.configDir(), 'credentials.toml'),
  facetsDir: () => join(paths.configDir(), 'facets'),
  database: () => join(home('data') ?? dirs.data, 'index.db'),
  thumbnails: () => join(home('cache') ?? dirs.cache, 'thumbnails'),
};

function home(kind: string): string | undefined {
  const root = process.env.JEVONGANIZE_HOME;
  return root ? join(root, kind) : undefined;
}

const provider = z.strictObject({
  name: z.enum(['openai', 'typesafe', 'gateway', 'cloudflare', 'openrouter', 'compatible', 'chat']),
  model: z.string().optional(),
  base_url: z.url().optional(),
  account_id: z.string().optional(),
});

const budget = z.strictObject({
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

const step = (match: string, ...use: string[]) => ({ match, use });

/** First match wins. Documented in docs/pipeline.md, which must stay in step with this. */
const DEFAULT_PIPELINE = [
  step('application/pdf', 'pdf', 'pdf-render'),
  step('image/hei*', 'heic', 'exif'),
  step('image/svg+xml', 'text', 'image'),
  step('image/*', 'image', 'exif', 'screenshot', 'quicklook'),
  step('audio/*', 'media'),
  step('video/*', 'media', 'ffmpeg-frames', 'quicklook'),
  step('message/rfc822', 'eml'),
  step('application/vnd.ms-outlook', 'msg'),
  step('application/zip', 'zip'),
  step('application/vnd.openxmlformats-*', 'office', 'quicklook'),
  step('application/vnd.oasis.*', 'office', 'quicklook'),
  step('application/rtf', 'office', 'quicklook'),
  step('application/epub+zip', 'office', 'quicklook'),
  step('text/html', 'office', 'text'),
  step('application/msword', 'libreoffice', 'quicklook'),
  step('application/vnd.ms-excel', 'libreoffice', 'quicklook'),
  step('application/vnd.ms-powerpoint', 'libreoffice', 'quicklook'),
  step('text/*', 'text'),
  step('*', 'text', 'quicklook'),
];

/** The whole config file. The settings form is generated from this schema's JSON Schema. */
export const configSchema = z.strictObject({
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
  provider: provider.default({ name: 'openai', model: 'gpt-6-luna' }),
  profiles: z.record(z.string(), provider).default({}),
  chat: provider.default({ name: 'openai', model: 'gpt-6-luna' }),
  facets: z
    .strictObject({
      enabled: z.array(z.string()).default(['core', 'time', 'sensitivity', 'media']),
      disabled: z.array(z.string()).default([]),
    })
    .prefault({}),
  thresholds: z
    .strictObject({
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
    })
    .prefault({}),
  budget: budget.prefault({}),
  pipeline: z
    .array(z.strictObject({ match: z.string(), use: z.array(z.string()).min(1) }))
    .default(DEFAULT_PIPELINE),
  watch: z
    .strictObject({
      enabled: z.boolean().default(true),
      walk_minutes: z
        .number()
        .positive()
        .default(30)
        .describe('Minutes between full checks, which catch missed events'),
    })
    .prefault({}),
});

export type Config = z.infer<typeof configSchema>;
export type Budget = Config['budget'];

/** True for a TOML table or any other plain object, but not for an array. */
export function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Awaits a file operation, turning "no such file" into `undefined`. */
export async function ifExists<T>(operation: Promise<T>): Promise<T | undefined> {
  try {
    return await operation;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
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
    const handle = await open(temp, 'wx', mode ?? current?.mode ?? 0o644);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
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

/** Validates a value, reporting every problem by key path in one `UserError`. */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown, source: string) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => `${[...issue.path, key].join('.')}: unknown key`)
      : `${issue.path.join('.')}: ${issue.message}`,
  );
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

async function readLayer(): Promise<Record<string, unknown>> {
  const file = paths.configFile();
  const text = await ifExists(readRegularFile(file));
  return text === undefined ? {} : parseToml(text, file);
}

/** Loads the config. A missing file gives the defaults. */
export async function loadConfig(): Promise<Config> {
  return parseWith(configSchema, await readLayer(), paths.configFile());
}

/** Merges a partial config into the file, keeping only what the user set. */
export async function saveConfig(change: Record<string, unknown>): Promise<Config> {
  const merged = mergeTables(await readLayer(), change);
  const config = parseWith(configSchema, merged, 'config');
  await writeFileAtomic(paths.configFile(), stringify(merged));
  return config;
}

/** The JSON Schema behind the settings form. */
export const configJsonSchema = () => z.toJSONSchema(configSchema, { io: 'input' });
