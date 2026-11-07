/**
 * Facets: loading presets and the user's own, choosing which apply, and the shape of their tags.
 *
 * A facet is one thing to find out about a file, and its `kind` says how: `flag` is yes or no,
 * `choice` picks a label, `multi` picks several, `level` picks a step on a scale, `date` picks a
 * year or month, and `field` copies metadata without asking anything. An answer becomes a tag
 * shaped `facet:value`, or `flag:facet`. An open facet may gain values through its vocabulary.
 * The schema a facet must pass is in facet-schema.ts, and the questions each kind puts to the
 * model are in facet-questions.ts.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Facet, Tag } from '../types.ts';
import {
  type Config,
  errorMessage,
  ifExists,
  parseToml,
  parseWith,
  paths,
  readRegularFile,
  UserError,
} from './config.ts';
import { facetFileSchema, facetSchema } from './facet-schema.ts';

/**
 * A proper name is not a judgement about a file but a fact in it, so it sits outside `max_tags`,
 * or a full file would have no room for one, and a run never replaces it.
 */
export const isName = (tag: Tag) => tag.startsWith('entity:');

/** One row of the `vocabulary` table. */
export interface VocabularyEntry {
  facet: string;
  value: string;
  state: 'proposed' | 'active' | 'retired';
}

/** The part of the database `withVocabulary` reads. */
export interface VocabularySource {
  listVocabulary(): VocabularyEntry[];
}

/** The longest tag this app generates, in code points. */
const MAX_TAG_LENGTH = 64;
/** The prefix of a `flag` facet's tag, which names the facet after it. */
const FLAG_PREFIX = 'flag:';
// src/core/facets.ts in development; dist/*.mjs once built.
const PRESET_DIRS = ['../../presets', '../presets'].map((dir) =>
  fileURLToPath(new URL(dir, import.meta.url)),
);

/** The `.toml` files in a folder, sorted, or undefined when the folder does not exist. */
async function tomlFilesIn(dir: string): Promise<string[] | undefined> {
  const names = await ifExists(readdir(dir));
  return names
    ?.filter((name) => name.endsWith('.toml'))
    .toSorted()
    .map((name) => join(dir, name));
}

/** Reads one facet file. A bad facet is skipped, and a bad file gives no facets. */
async function readFacetFile(file: string, warn: (message: string) => void): Promise<Facet[]> {
  const toml = parseToml(await readRegularFile(file), file);
  const { pack, facet: entries } = parseWith(facetFileSchema, toml, file);
  const facets: Facet[] = [];
  for (const entry of entries) {
    const name = `${file}: facet ${String(entry.id)}`;
    try {
      facets.push(parseWith(facetSchema, { ...entry, pack }, name));
    } catch (error) {
      warn(errorMessage(error));
    }
  }
  return facets;
}

/** Reads facet files in order. The first facet with an id wins, and a later one is skipped. */
async function readFacetFiles(
  files: string[],
  warn: (message: string) => void,
): Promise<Map<string, Facet>> {
  const facets = new Map<string, Facet>();
  for (const file of files) {
    try {
      for (const facet of await readFacetFile(file, warn)) {
        if (facets.has(facet.id)) warn(`${file}: duplicate facet id ${facet.id}, skipped`);
        else facets.set(facet.id, facet);
      }
    } catch (error) {
      warn(`${file}: skipped. ${errorMessage(error)}`);
    }
  }
  return facets;
}

/** The files of the first preset folder that exists. */
async function presetFiles(): Promise<string[] | undefined> {
  for (const dir of PRESET_DIRS) {
    const files = await tomlFilesIn(dir);
    if (files) return files;
  }
  return undefined;
}

/**
 * Loads presets and the user's facets, enabled or not. A custom facet replaces a preset with its
 * id. A bad file or facet is reported through `warn` and skipped.
 */
export async function loadFacets(
  _config: Config,
  warn: (message: string) => void = (message) => process.emitWarning(message),
): Promise<Facet[]> {
  const presets = await presetFiles();
  if (!presets) warn('The presets folder is missing.');
  const custom = (await tomlFilesIn(paths.facetsDir())) ?? [];
  const facets = await readFacetFiles(presets ?? [], warn);
  for (const [id, facet] of await readFacetFiles(custom, warn)) facets.set(id, facet);
  return [...facets.values()];
}

/** Every value of the topic catalog, such as `finance/budgeting`. */
export async function loadCatalog(): Promise<string[]> {
  for (const dir of PRESET_DIRS) {
    const text = await ifExists(readFile(join(dir, 'catalog.txt'), 'utf8'));
    if (text) return text.split('\n').filter(Boolean);
  }
  throw new UserError('The topic catalog is missing.');
}

/** True when `[facets]` turns this facet on. `disabled` wins. */
export function isEnabled(facet: Facet, { facets }: Pick<Config, 'facets'>): boolean {
  const named = (list: string[]) => list.includes(facet.id) || list.includes(facet.pack);
  return named(facets.enabled) && !named(facets.disabled);
}

/** True when the facet's `applies_to` globs match this MIME type. */
export function appliesTo(facet: Facet, mime: string): boolean {
  if (facet.applies_to.length === 0) return true;
  return facet.applies_to.some((glob) =>
    glob.endsWith('*') ? mime.startsWith(glob.slice(0, -1)) : glob === mime,
  );
}

/** An open facet's values once its vocabulary is applied: active ones added, retired ones gone. */
function vocabularyValues(facet: Facet, entries: VocabularyEntry[]): Record<string, string> {
  const values = { ...facet.values };
  for (const { facet: owner, value, state } of entries) {
    if (owner !== facet.id) continue;
    if (state === 'active') values[value] ??= `The file clearly concerns "${value}".`;
    if (state === 'retired') delete values[value];
  }
  return values;
}

/** Merges active values into open facets, and takes retired ones out. */
export function withVocabulary(facets: Facet[], db: VocabularySource): Facet[] {
  const entries = db.listVocabulary();
  return facets.map((facet) =>
    facet.open ? { ...facet, values: vocabularyValues(facet, entries) } : facet,
  );
}

/** The facet a tag belongs to, if it has that shape. */
export function tagFacet(tag: Tag): string {
  if (tag.startsWith(FLAG_PREFIX)) return tag.slice(FLAG_PREFIX.length);
  const colon = tag.indexOf(':');
  return colon === -1 ? '' : tag.slice(0, colon);
}

/** The tag for a facet's value. */
export function tagFor(facet: Facet, value: string): Tag {
  return facet.kind === 'flag' ? `${FLAG_PREFIX}${facet.id}` : `${facet.id}:${value}`;
}

/** Reduces untrusted text to one kebab-case tag part, which may be empty. */
export function slug(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(/[,;"\\*?/]/g, ' ')
    .trim()
    .split(/\s+/)
    .join('-');
}

/** Cuts a tag to the generated-tag limit, by code point, with no dangling separator. */
export function fitTag(tag: Tag): Tag {
  return Array.from(tag)
    .slice(0, MAX_TAG_LENGTH)
    .join('')
    .replace(/[-/]+$/, '');
}
