/**
 * Turns what a model or the metadata said about a file into tags, in two stages.
 *
 * `fromAnswers` checks a model's raw reply and makes `Answer` rows, which are what the cache keeps.
 * `resolve` then applies the thresholds. Each answer gives a candidate tag, which is applied, sent
 * to a person for review, or dropped. Tags copied from metadata come from `derive` and skip the
 * thresholds, as nothing was guessed. A model's text is never a tag: it only selects a defined label.
 */
import type { Answer, Facet, FileState, Tag } from '../types.ts';
import type { Config } from './config.ts';
import { FIRST_YEAR, fitTag, isName, LAST_YEAR, slug, tagFacet, tagFor } from './facets.ts';

/** An answer as the SDK returns it. */
export type RawAnswer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'refusal' };

/** A model's raw answers to one request. */
export type RawAnswers = Record<string, RawAnswer>;

const MULTI_KEEP = 3;
/** The step of a `level` meaning "does not apply". Like `other`, it writes no tag. */
const NO_LEVEL = 'none';
const SINGLE_VALUED = new Set<Facet['kind']>(['choice', 'level', 'date', 'field']);
const STORED_DATE = /^\d{4}(-\d{2})?$/;
const MONTH = /^(0[1-9]|1[0-2])$/;

/** Whether a stored answer could have come from this facet as it stands. See docs/security.md. */
export function validAnswer(facet: Facet, answer: Answer): boolean {
  const { value, confidence } = answer;
  if (answer.facet !== facet.id) return false;
  const confidenceInRange = confidence === null || (confidence >= 0 && confidence <= 1);
  if (!confidenceInRange) return false;
  if (value === null) return true;
  if (facet.kind === 'flag') return value === 'yes';
  if (facet.kind === 'level') return facet.levels?.includes(value) ?? false;
  if (facet.kind === 'date') return STORED_DATE.test(value);
  return facet.kind !== 'field' && Object.hasOwn(facet.values ?? {}, value);
}

const answerRow = (facet: Facet, value: string | null, confidence: number | null): Answer => ({
  facet: facet.id,
  value,
  confidence,
  estimated: false,
  refused: false,
});

const refusal = (facet: Facet): Answer => ({ ...answerRow(facet, null, null), refused: true });

type ChoiceAnswer = Extract<RawAnswer, { type: 'choice' }>;

const choiceConfidence = ({ choice, probabilities }: ChoiceAnswer) =>
  probabilities?.[choice] ?? null;

function flagAnswer(facet: Facet, given: RawAnswer | undefined): Answer {
  return given?.type === 'boolean' ? answerRow(facet, 'yes', given.probability) : refusal(facet);
}

function choiceAnswer(facet: Facet, given: RawAnswer | undefined): Answer {
  if (given?.type !== 'choice') return refusal(facet);
  const known = Object.hasOwn(facet.values ?? {}, given.choice);
  return answerRow(facet, known ? given.choice : null, choiceConfidence(given));
}

function multiAnswers(facet: Facet, raw: RawAnswers): Answer[] {
  return Object.keys(facet.values ?? {}).map((value) => {
    const label = raw[`${facet.id}.${value}`];
    return label?.type === 'boolean' ? answerRow(facet, value, label.probability) : refusal(facet);
  });
}

function levelAnswer(facet: Facet, given: RawAnswer | undefined): Answer {
  if (given?.type !== 'score') return refusal(facet);
  const levels = facet.levels ?? [];
  const index = Math.min(Math.max(Math.round(given.score), 0), levels.length - 1);
  const step = levels[index] ?? null;
  const confidence = given.probabilities?.[index] ?? null;
  return answerRow(facet, step === NO_LEVEL ? null : step, confidence);
}

function dateAnswer(facet: Facet, raw: RawAnswers): Answer {
  const year = raw[`${facet.id}.year`];
  if (year?.type !== 'choice') return refusal(facet);
  const yearConfidence = choiceConfidence(year);
  const yearNumber = Number(year.choice);
  const yearOffered = yearNumber >= FIRST_YEAR && yearNumber <= LAST_YEAR;
  if (!yearOffered) return answerRow(facet, null, yearConfidence);
  const month = raw[`${facet.id}.month`];
  if (month?.type !== 'choice' || !MONTH.test(month.choice)) {
    return answerRow(facet, year.choice, yearConfidence);
  }
  const monthConfidence = choiceConfidence(month);
  const bothKnown = yearConfidence !== null && monthConfidence !== null;
  const confidence = bothKnown ? Math.min(yearConfidence, monthConfidence) : null;
  return answerRow(facet, `${year.choice}-${month.choice}`, confidence);
}

/** Turns raw answers into `Answer` rows, one per label for `multi`. */
export function fromAnswers(facet: Facet, raw: RawAnswers): Answer[] {
  const given = raw[facet.id];
  switch (facet.kind) {
    case 'flag':
      return [flagAnswer(facet, given)];
    case 'choice':
      return [choiceAnswer(facet, given)];
    case 'multi':
      return multiAnswers(facet, raw);
    case 'level':
      return [levelAnswer(facet, given)];
    case 'date':
      return [dateAnswer(facet, raw)];
    case 'field':
      break;
  }
  return [];
}

/** A metadata date as the value of a tag in this format, or null if it cannot be one. */
function dateTagValue(text: string, format: NonNullable<Facet['format']>, fiscalStart: number) {
  const [, year, month] = /^(\d{4})(?:-(\d{2}))?/.exec(text) ?? [];
  if (!year || Number.isNaN(Date.parse(text))) return null;
  if (format === 'year') return year;
  if (!month) return null;
  if (format === 'month') return `${year}-${month}`;
  const fiscalYear = Number(month) >= fiscalStart ? Number(year) : Number(year) - 1;
  return `FY${fiscalYear}`;
}

/** The tag of a `field` facet, copied from metadata and cleaned, or null. */
export function derive(
  facet: Facet,
  state: Pick<FileState, 'metadata'>,
  config: Config,
): Tag | null {
  if (facet.kind !== 'field' || facet.field === undefined) return null;
  const value = state.metadata[facet.field];
  if (value === undefined) return null;
  if (facet.format) {
    const date = dateTagValue(String(value), facet.format, config.fiscal_year_start);
    return date && `${facet.id}:${date}`;
  }
  if (typeof value === 'boolean') return value ? `flag:${facet.id}` : null;
  const firstRecipient = () => String(value).split(/[,;]/)[0] ?? '';
  const text = facet.field === 'to' ? firstRecipient() : String(value);
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
function byText(a: Candidate, b: Candidate): number {
  if (a.tag === b.tag) return 0;
  return a.tag < b.tag ? -1 : 1;
}

const byRank = (a: Candidate, b: Candidate) =>
  b.facet.weight - a.facet.weight || byConfidence(a, b) || byText(a, b);

/** Keeps the best candidate per tag, and the top labels of each `multi`. */
function keepBest(candidates: Candidate[]): Candidate[] {
  const bestByTag = new Map<Tag, Candidate>();
  const sorted = candidates.toSorted((a, b) => byConfidence(a, b) || byText(a, b));
  const keptPerFacet = new Map<string, number>();
  for (const candidate of sorted) {
    if (bestByTag.has(candidate.tag)) continue;
    const kept = keptPerFacet.get(candidate.facet.id) ?? 0;
    if (candidate.facet.kind === 'multi' && kept >= MULTI_KEEP) continue;
    keptPerFacet.set(candidate.facet.id, kept + 1);
    bestByTag.set(candidate.tag, candidate);
  }
  return [...bestByTag.values()];
}

/** The candidate an answer makes, or null when it says nothing or too little. */
function answerCandidate(
  facet: Facet,
  answer: Answer,
  thresholds: Config['thresholds'],
): Candidate | null {
  const { value, confidence, estimated, refused } = answer;
  if (refused || value === null) return null;
  if (confidence !== null && confidence < thresholds.review) return null;
  const tag = tagFor(facet, facet.aliases?.[value] ?? value);
  const mustReview = confidence === null || (estimated && thresholds.estimated_to_review);
  const applyAt = facet.apply_above ?? thresholds.apply;
  const apply = !mustReview && confidence >= applyAt;
  return { facet, tag, confidence, apply };
}

interface HeldTags {
  existing: Tag[];
  rejected: Tag[];
  derived?: Tag[];
}

/** Every tag the answers and `derived` could add, leaving out what `held` blocks. */
function gatherCandidates(
  answers: Answer[],
  facets: Facet[],
  thresholds: Config['thresholds'],
  { existing, rejected, derived = [] }: HeldTags,
): Candidate[] {
  const facetsById = new Map(facets.map((facet) => [facet.id, facet]));
  const fillsOnlySlot = (facet: Facet) =>
    SINGLE_VALUED.has(facet.kind) && existing.some((held) => held.startsWith(`${facet.id}:`));
  const blocked = (facet: Facet, tag: Tag) =>
    rejected.includes(tag) || existing.includes(tag) || fillsOnlySlot(facet);

  const candidates: Candidate[] = [];
  for (const answer of answers) {
    const facet = facetsById.get(answer.facet);
    const candidate = facet && answerCandidate(facet, answer, thresholds);
    if (candidate && !blocked(candidate.facet, candidate.tag)) candidates.push(candidate);
  }
  for (const tag of derived) {
    const facet = facetsById.get(tagFacet(tag));
    if (facet && !blocked(facet, tag)) candidates.push({ facet, tag, confidence: 1, apply: true });
  }
  return candidates;
}

/**
 * Applies thresholds to raw answers. Pure, so changing a threshold needs no model call. `derived`
 * holds the tags of `field` facets, which rank with confidence 1.
 */
export function resolve(
  answers: Answer[],
  facets: Facet[],
  config: Config,
  tags: HeldTags,
): { apply: Tag[]; review: { tag: Tag; confidence: number | null }[] } {
  const candidates = gatherCandidates(answers, facets, config.thresholds, tags);
  const ranked = keepBest(candidates).toSorted(byRank);
  const room = Math.max(config.max_tags - tags.existing.filter((tag) => !isName(tag)).length, 0);
  const applied = ranked.filter((candidate) => candidate.apply).map((candidate) => candidate.tag);
  return {
    apply: [...applied.filter(isName), ...applied.filter((tag) => !isName(tag)).slice(0, room)],
    review: ranked
      .filter((candidate) => !candidate.apply)
      .map(({ tag, confidence }) => ({ tag, confidence })),
  };
}
