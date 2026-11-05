/** Facets: loads presets, maps them to questions, and turns answers into tags. */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Answer, Facet, FileState, Tag } from '../types.ts';
import { type Config, ifExists, parseToml, parseWith, paths, readRegularFile } from './config.ts';

/** A question as plain data. Its shape matches the SDK's, so `core/` need not import it. */
export type Question =
  | { type: 'boolean'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

/** An answer as the SDK returns it, by question id. */
export type RawAnswer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'refusal' };

export type RawAnswers = Record<string, RawAnswer>;

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
const MULTI_KEEP = 3;
/** Fixed, because a span that moved with the clock would change `facetHash` each January. */
const FIRST_YEAR = 1990;
const LAST_YEAR = 2039;
const OTHER = 'None of the other options fits, or the question does not apply.';
/** The step of a `level` meaning "does not apply". Like `other`, it writes no tag. */
const NO_LEVEL = 'none';
const SINGLE_VALUED = new Set<Facet['kind']>(['choice', 'level', 'date', 'field']);
const FORBIDDEN = /[\p{Cc}\s,;"\\*?]/u;

const id = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
  .refine((value) => value !== 'flag', '"flag" is reserved');

const label = z
  .string()
  .refine((value) => value !== 'other', '"other" is reserved')
  .refine(
    (value) => !FORBIDDEN.test(value) && value.split('/').every(Boolean),
    'breaks the tag grammar',
  );

const common = {
  id,
  pack: z.string().min(1),
  title: z.string().min(1),
  applies_to: z.array(z.string()).default([]),
  weight: z.number().nonnegative().default(1),
};

const asked = {
  ...common,
  instructions: z.string().min(1),
  apply_above: z.number().min(0).max(1).optional(),
  profile: z.string().optional(),
};

const aliases = z.record(z.string(), z.string()).optional();
const hasValues = (values: Record<string, string>) => Object.keys(values).length > 0;

/** One facet, with the keys that belong to its kind and no others. */
export const facetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...asked, kind: z.literal('flag') }),
  z.strictObject({
    ...asked,
    kind: z.literal('choice'),
    values: z
      .record(label, z.string().min(1))
      .refine(hasValues, 'needs values')
      .refine((values) => Object.keys(values).length <= 254, 'more than 254 labels'),
    aliases,
  }),
  z
    .strictObject({
      ...asked,
      kind: z.literal('multi'),
      values: z.record(label, z.string().min(1)).default({}),
      open: z.boolean().optional(),
      aliases,
    })
    .refine((facet) => facet.open || hasValues(facet.values), 'needs values unless it is open'),
  z.strictObject({
    ...asked,
    kind: z.literal('level'),
    levels: z.array(label).min(2).max(10),
    aliases,
  }),
  z.strictObject({
    ...asked,
    kind: z.literal('date'),
    precision: z.enum(['year', 'month']).default('year'),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('field'),
    field: z.string().min(1),
    format: z.enum(['year', 'month', 'fiscal-year']).optional(),
  }),
]);

const fileSchema = z.strictObject({
  pack: id,
  title: z.string().min(1),
  facet: z.array(z.record(z.string(), z.unknown())).default([]),
});

// src/core/facets.ts in development; dist/*.mjs once built.
const PRESET_DIRS = ['../../presets', '../presets'].map((dir) =>
  fileURLToPath(new URL(dir, import.meta.url)),
);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function tomlFiles(dir: string): Promise<string[] | undefined> {
  const names = await ifExists(readdir(dir));
  return names
    ?.filter((name) => name.endsWith('.toml'))
    .toSorted()
    .map((name) => join(dir, name));
}

/** Reads one facet file. A bad facet is skipped, and a bad file gives no facets. */
async function readFacetFile(file: string, warn: (message: string) => void): Promise<Facet[]> {
  const { pack, facet: raw } = parseWith(
    fileSchema,
    parseToml(await readRegularFile(file), file),
    file,
  );
  const facets: Facet[] = [];
  for (const entry of raw) {
    const name = `${file}: facet ${String(entry.id)}`;
    try {
      facets.push(parseWith(facetSchema, { ...entry, pack }, name));
    } catch (error) {
      warn(messageOf(error));
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
      warn(`${file}: skipped. ${messageOf(error)}`);
    }
  }
  return facets;
}

/**
 * Loads presets and the user's facets, enabled or not. A custom facet replaces a preset with its
 * id. A bad file or facet is reported through `warn` and skipped.
 */
export async function loadFacets(
  _config: Config,
  warn: (message: string) => void = (message) => process.emitWarning(message),
): Promise<Facet[]> {
  let presets: string[] | undefined;
  for (const dir of PRESET_DIRS) presets ??= await tomlFiles(dir);
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

/** Merges active values into open facets, and takes retired ones out. */
export function withVocabulary(facets: Facet[], db: VocabularySource): Facet[] {
  const entries = db.listVocabulary();
  return facets.map((facet) => {
    if (!facet.open) return facet;
    const values = { ...facet.values };
    for (const { facet: owner, value, state } of entries) {
      if (owner !== facet.id) continue;
      if (state === 'active') values[value] ??= `The file clearly concerns "${value}".`;
      if (state === 'retired') delete values[value];
    }
    return { ...facet, values };
  });
}

const years = () => {
  const options: Record<string, string | null> = {};
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) options[year] = null;
  return { ...options, other: OTHER };
};

const months = () => {
  const options: Record<string, string | null> = {};
  for (let month = 1; month <= 12; month++) options[String(month).padStart(2, '0')] = null;
  return { ...options, other: OTHER };
};

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
      return Object.fromEntries(
        Object.entries(facet.values ?? {}).map(([value, definition]) => [
          `${facet.id}.${value}`,
          { type: 'boolean', instructions: `${instructions}\n${value}: ${definition}` },
        ]),
      );
    case 'level':
      return { [facet.id]: { type: 'score', instructions, criteria: facet.levels ?? [] } };
    case 'date': {
      const year: Question = {
        type: 'choice',
        instructions: `${instructions} Give the year.`,
        criteria: years(),
      };
      if (facet.precision !== 'month') return { [`${facet.id}.year`]: year };
      return {
        [`${facet.id}.year`]: year,
        [`${facet.id}.month`]: {
          type: 'choice',
          instructions: `${instructions} Give the month, as two digits.`,
          criteria: months(),
        },
      };
    }
    case 'field':
      break;
  }
  return {};
}

/** Facets are never changed in place: `withVocabulary` makes new ones. */
const hashes = new WeakMap<Facet, string>();

/** Hashes exactly what the model sees, so weights, titles and aliases never cost a re-ask. */
export function facetHash(facet: Facet): string {
  let hash = hashes.get(facet);
  if (hash === undefined) {
    hash = createHash('sha256')
      .update(JSON.stringify(toQuestions(facet)))
      .digest('hex');
    hashes.set(facet, hash);
  }
  return hash;
}

/** Whether a stored answer could have come from this facet as it stands. See docs/security.md. */
export function validAnswer(facet: Facet, answer: Answer): boolean {
  const { value, confidence } = answer;
  if (answer.facet !== facet.id) return false;
  if (confidence !== null && !(confidence >= 0 && confidence <= 1)) return false;
  if (value === null) return true;
  if (facet.kind === 'flag') return value === 'yes';
  if (facet.kind === 'level') return facet.levels?.includes(value) ?? false;
  if (facet.kind === 'date') return /^\d{4}(-\d{2})?$/.test(value);
  return facet.kind !== 'field' && Object.hasOwn(facet.values ?? {}, value);
}

/** Turns raw answers into `Answer` rows, one per label for `multi`. */
export function fromAnswers(facet: Facet, raw: RawAnswers): Answer[] {
  const answer = (value: string | null, confidence: number | null, refused = false): Answer => ({
    facet: facet.id,
    value,
    confidence,
    estimated: false,
    refused,
  });
  const refusal = answer(null, null, true);
  const given = raw[facet.id];
  switch (facet.kind) {
    case 'flag':
      return [given?.type === 'boolean' ? answer('yes', given.probability) : refusal];
    case 'choice': {
      if (given?.type !== 'choice') return [refusal];
      const known = Object.hasOwn(facet.values ?? {}, given.choice);
      return [answer(known ? given.choice : null, given.probabilities?.[given.choice] ?? null)];
    }
    case 'multi':
      return Object.keys(facet.values ?? {}).map((value) => {
        const one = raw[`${facet.id}.${value}`];
        return one?.type === 'boolean' ? answer(value, one.probability) : refusal;
      });
    case 'level': {
      if (given?.type !== 'score') return [refusal];
      const levels = facet.levels ?? [];
      const index = Math.min(Math.max(Math.round(given.score), 0), levels.length - 1);
      const step = levels[index] ?? null;
      return [answer(step === NO_LEVEL ? null : step, given.probabilities?.[index] ?? null)];
    }
    case 'date':
      return [dateAnswer(facet, raw, answer, refusal)];
    case 'field':
      break;
  }
  return [];
}

function dateAnswer(
  facet: Facet,
  raw: RawAnswers,
  answer: (value: string | null, confidence: number | null) => Answer,
  refusal: Answer,
): Answer {
  const year = raw[`${facet.id}.year`];
  if (year?.type !== 'choice') return refusal;
  const yearP = year.probabilities?.[year.choice] ?? null;
  const number = Number(year.choice);
  if (!(number >= FIRST_YEAR && number <= LAST_YEAR)) return answer(null, yearP);
  const month = raw[`${facet.id}.month`];
  if (month?.type !== 'choice' || !/^(0[1-9]|1[0-2])$/.test(month.choice)) {
    return answer(year.choice, yearP);
  }
  const monthP = month.probabilities?.[month.choice] ?? null;
  const confidence = yearP === null || monthP === null ? null : Math.min(yearP, monthP);
  return answer(`${year.choice}-${month.choice}`, confidence);
}

/** The facet a tag belongs to, if it has that shape. */
export const tagFacet = (tag: Tag) =>
  tag.startsWith('flag:') ? tag.slice(5) : tag.slice(0, Math.max(tag.indexOf(':'), 0));

/** The tag for a facet's value. */
export function tagFor(facet: Facet, value: string): Tag {
  return facet.kind === 'flag' ? `flag:${facet.id}` : `${facet.id}:${value}`;
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

function dated(text: string, format: NonNullable<Facet['format']>, fiscalStart: number) {
  const parts = /^(\d{4})(?:-(\d{2}))?/.exec(text);
  if (!parts?.[1] || Number.isNaN(Date.parse(text))) return null;
  const year = Number(parts[1]);
  if (format === 'year') return parts[1];
  if (!parts[2]) return null;
  if (format === 'month') return `${parts[1]}-${parts[2]}`;
  return `FY${Number(parts[2]) >= fiscalStart ? year : year - 1}`;
}

/** The tag of a `field` facet, copied from metadata and cleaned, or null. */
export function derive(facet: Facet, state: FileState, config: Config): Tag | null {
  const value = facet.field === undefined ? undefined : state.metadata[facet.field];
  if (facet.kind !== 'field' || value === undefined) return null;
  if (facet.format) {
    const date = dated(String(value), facet.format, config.fiscal_year_start);
    return date && `${facet.id}:${date}`;
  }
  if (typeof value === 'boolean') return value ? `flag:${facet.id}` : null;
  const text = facet.field === 'to' ? (String(value).split(/[,;]/)[0] ?? '') : String(value);
  const prefix = `${facet.id}:`;
  const tag = fitTag(prefix + slug(text));
  return tag.length > prefix.length ? tag : null;
}

interface Candidate {
  facet: Facet;
  tag: Tag;
  confidence: number | null;
  apply: boolean;
}

const byConfidence = (a: Candidate, b: Candidate) => (b.confidence ?? -1) - (a.confidence ?? -1);
const byText = (a: Candidate, b: Candidate) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
const byRank = (a: Candidate, b: Candidate) =>
  b.facet.weight - a.facet.weight || byConfidence(a, b) || byText(a, b);

/** Keeps the best candidate per tag, and the top labels of each `multi`. */
function trim(candidates: Candidate[]): Candidate[] {
  const best = new Map<Tag, Candidate>();
  const sorted = candidates.toSorted((a, b) => byConfidence(a, b) || byText(a, b));
  const counts = new Map<string, number>();
  for (const candidate of sorted) {
    if (best.has(candidate.tag)) continue;
    const count = counts.get(candidate.facet.id) ?? 0;
    if (candidate.facet.kind === 'multi' && count >= MULTI_KEEP) continue;
    counts.set(candidate.facet.id, count + 1);
    best.set(candidate.tag, candidate);
  }
  return [...best.values()];
}

/**
 * Applies thresholds to raw answers. Pure, so changing a threshold needs no model call. `derived`
 * holds the tags of `field` facets, which rank with confidence 1.
 */
export function resolve(
  answers: Answer[],
  facets: Facet[],
  config: Config,
  existing: Tag[],
  rejected: Tag[],
  derived: Tag[] = [],
): { apply: Tag[]; review: { tag: Tag; confidence: number | null }[] } {
  const known = new Map(facets.map((facet) => [facet.id, facet]));
  const { thresholds } = config;
  const blocked = (facet: Facet, tag: Tag) =>
    rejected.includes(tag) ||
    existing.includes(tag) ||
    (SINGLE_VALUED.has(facet.kind) && existing.some((held) => held.startsWith(`${facet.id}:`)));

  const candidates: Candidate[] = [];
  for (const { facet: name, value, confidence, estimated, refused } of answers) {
    const facet = known.get(name);
    if (!facet || refused || value === null) continue;
    const tag = tagFor(facet, facet.aliases?.[value] ?? value);
    if (blocked(facet, tag)) continue;
    if (confidence !== null && confidence < thresholds.review) continue;
    const apply =
      confidence !== null &&
      !(estimated && thresholds.estimated_to_review) &&
      confidence >= (facet.apply_above ?? thresholds.apply);
    candidates.push({ facet, tag, confidence, apply });
  }
  for (const tag of derived) {
    const facet = known.get(tagFacet(tag));
    if (facet && !blocked(facet, tag)) candidates.push({ facet, tag, confidence: 1, apply: true });
  }

  const kept = trim(candidates);
  const room = Math.max(config.max_tags - existing.length, 0);
  return {
    apply: kept
      .filter((candidate) => candidate.apply)
      .toSorted(byRank)
      .slice(0, room)
      .map((candidate) => candidate.tag),
    review: kept
      .filter((candidate) => !candidate.apply)
      .toSorted(byRank)
      .map(({ tag, confidence }) => ({ tag, confidence })),
  };
}
