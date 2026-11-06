/**
 * Facets: loads presets, maps them to questions, and defines the shape of their tags.
 *
 * A facet is one thing to find out about a file, and its `kind` says how: `flag` is yes or no,
 * `choice` picks a label, `multi` picks several, `level` picks a step on a scale, `date` picks a
 * year or month, and `field` copies metadata without asking anything. An answer becomes a tag
 * shaped `facet:value`, or `flag:facet`. An open facet may gain values through its vocabulary.
 */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Facet, Tag } from '../types.ts';
import {
  type Config,
  errorMessage,
  ifExists,
  parseToml,
  parseWith,
  paths,
  readRegularFile,
} from './config.ts';

/** A question as plain data. Its shape matches the SDK's, so `core/` need not import it. */
export type Question =
  | { type: 'boolean'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

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

const MAX_TAG_LENGTH = 64;
/** Fixed, because a span that moved with the clock would change `facetHash` each January. */
export const FIRST_YEAR = 1990;
/** The last year a `date` facet offers. */
export const LAST_YEAR = 2039;
const OTHER = 'None of the other options fits, or the question does not apply.';
const FLAG_PREFIX = 'flag:';
/** Stricter than a tag: a label is one word of the tag grammar, so it holds no space either. */
const LABEL_FORBIDDEN = /[\p{Cc}\s,;"\\*?]/u;

const facetId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
  .refine((value) => value !== 'flag', '"flag" is reserved');

const facetLabel = z
  .string()
  .refine((value) => value !== 'other', '"other" is reserved')
  .refine(
    (value) => !LABEL_FORBIDDEN.test(value) && value.split('/').every(Boolean),
    'breaks the tag grammar',
  );

const commonKeys = {
  id: facetId,
  pack: z.string().min(1),
  title: z.string().min(1),
  applies_to: z.array(z.string()).default([]),
  weight: z.number().nonnegative().default(1),
};

const askedKeys = {
  ...commonKeys,
  instructions: z.string().min(1),
  apply_above: z.number().min(0).max(1).optional(),
  profile: z.string().optional(),
};

const aliases = z.record(z.string(), z.string()).optional();
const hasValues = (values: Record<string, string>) => Object.keys(values).length > 0;

/** One facet, with the keys that belong to its kind and no others. */
export const facetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...askedKeys, kind: z.literal('flag') }),
  z.strictObject({
    ...askedKeys,
    kind: z.literal('choice'),
    values: z
      .record(facetLabel, z.string().min(1))
      .refine(hasValues, 'needs values')
      .refine((values) => Object.keys(values).length <= 254, 'more than 254 labels'),
    aliases,
  }),
  z
    .strictObject({
      ...askedKeys,
      kind: z.literal('multi'),
      values: z.record(facetLabel, z.string().min(1)).default({}),
      open: z.boolean().optional(),
      aliases,
    })
    .refine((facet) => facet.open || hasValues(facet.values), 'needs values unless it is open'),
  z.strictObject({
    ...askedKeys,
    kind: z.literal('level'),
    levels: z.array(facetLabel).min(2).max(10),
    aliases,
  }),
  z.strictObject({
    ...askedKeys,
    kind: z.literal('date'),
    precision: z.enum(['year', 'month']).default('year'),
  }),
  z.strictObject({
    ...commonKeys,
    kind: z.literal('field'),
    field: z.string().min(1),
    format: z.enum(['year', 'month', 'fiscal-year']).optional(),
  }),
]);

const fileSchema = z.strictObject({
  pack: facetId,
  title: z.string().min(1),
  facet: z.array(z.record(z.string(), z.unknown())).default([]),
});

// src/core/facets.ts in development; dist/*.mjs once built.
const PRESET_DIRS = ['../../presets', '../presets'].map((dir) =>
  fileURLToPath(new URL(dir, import.meta.url)),
);

async function tomlFiles(dir: string): Promise<string[] | undefined> {
  const names = await ifExists(readdir(dir));
  return names
    ?.filter((name) => name.endsWith('.toml'))
    .toSorted()
    .map((name) => join(dir, name));
}

/** Reads one facet file. A bad facet is skipped, and a bad file gives no facets. */
async function readFacetFile(file: string, warn: (message: string) => void): Promise<Facet[]> {
  const toml = parseToml(await readRegularFile(file), file);
  const { pack, facet: entries } = parseWith(fileSchema, toml, file);
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

async function readFacetDir(
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
    const files = await tomlFiles(dir);
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
  const custom = (await tomlFiles(paths.facetsDir())) ?? [];
  const facets = await readFacetDir(presets ?? [], warn);
  for (const [key, facet] of await readFacetDir(custom, warn)) facets.set(key, facet);
  return [...facets.values()];
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

const yearCriteria = () => {
  const options: Record<string, string | null> = {};
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) options[year] = null;
  return { ...options, other: OTHER };
};

const monthCriteria = () => {
  const options: Record<string, string | null> = {};
  for (let month = 1; month <= 12; month++) options[String(month).padStart(2, '0')] = null;
  return { ...options, other: OTHER };
};

/** One yes-or-no question per label of a `multi`. */
function multiQuestions(facet: Facet, instructions: string): Record<string, Question> {
  return Object.fromEntries(
    Object.entries(facet.values ?? {}).map(([value, definition]) => [
      `${facet.id}.${value}`,
      { type: 'boolean', instructions: `${instructions}\n${value}: ${definition}` },
    ]),
  );
}

function dateQuestions(facet: Facet, instructions: string): Record<string, Question> {
  const yearQuestion: Question = {
    type: 'choice',
    instructions: `${instructions} Give the year.`,
    criteria: yearCriteria(),
  };
  if (facet.precision !== 'month') return { [`${facet.id}.year`]: yearQuestion };
  return {
    [`${facet.id}.year`]: yearQuestion,
    [`${facet.id}.month`]: {
      type: 'choice',
      instructions: `${instructions} Give the month, as two digits.`,
      criteria: monthCriteria(),
    },
  };
}

/** The SDK questions for a facet. `field`, and an open facet with no values, ask nothing. */
export function toQuestions(facet: Facet): Record<string, Question> {
  const instructions = facet.instructions ?? '';
  switch (facet.kind) {
    case 'flag':
      return { [facet.id]: { type: 'boolean', instructions } };
    case 'choice':
      return {
        [facet.id]: {
          type: 'choice',
          instructions,
          criteria: { ...facet.values, other: OTHER },
        },
      };
    case 'multi':
      return multiQuestions(facet, instructions);
    case 'level':
      return { [facet.id]: { type: 'score', instructions, criteria: facet.levels ?? [] } };
    case 'date':
      return dateQuestions(facet, instructions);
    case 'field':
      break;
  }
  return {};
}

/** Facets are never changed in place: `withVocabulary` makes new ones. */
const facetHashes = new WeakMap<Facet, string>();

/** Hashes exactly what the model sees, so weights, titles and aliases never cost a re-ask. */
export function facetHash(facet: Facet): string {
  const known = facetHashes.get(facet);
  if (known !== undefined) return known;
  const hash = createHash('sha256')
    .update(JSON.stringify(toQuestions(facet)))
    .digest('hex');
  facetHashes.set(facet, hash);
  return hash;
}

/** The facet a tag belongs to, if it has that shape. */
export function tagFacet(tag: Tag): string {
  if (tag.startsWith(FLAG_PREFIX)) return tag.slice(FLAG_PREFIX.length);
  return tag.slice(0, Math.max(tag.indexOf(':'), 0));
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
