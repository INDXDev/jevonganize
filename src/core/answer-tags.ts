/**
 * The second stage from answers to tags: deciding. Each checked answer gives a candidate tag, and
 * `resolve` applies the thresholds to it: applied, sent to a person for review, or dropped. Tags
 * copied from metadata come from `derive` and skip the thresholds, as nothing was guessed. Both are
 * pure, so changing a threshold costs no model call.
 */
import type { Answer, Facet, FileState, Tag } from '../types.ts';
import type { Config } from './config.ts';
import { fitTag, isName, slug, tagFacet, tagFor } from './facets.ts';

/** At most this many labels of one `multi` facet become tags, the likeliest first. */
const MULTI_LABELS_KEPT = 3;
/** Kinds that hold one value per file, so a file that has their tag gets no second one. */
const SINGLE_VALUED = new Set<Facet['kind']>(['choice', 'level', 'date', 'field']);
/** The start of a metadata date: a year, then an optional month. */
const LEADING_YEAR_MONTH = /^(\d{4})(?:-(\d{2}))?/;

/** A metadata date as the value of a tag in this format, or null if it cannot be one. */
function dateTagValue(text: string, format: NonNullable<Facet['format']>, fiscalStart: number) {
  const [, year, month] = LEADING_YEAR_MONTH.exec(text) ?? [];
  if (!year || Number.isNaN(Date.parse(text))) return null;
  if (format === 'year') return year;
  if (!month) return null;
  if (format === 'month') return `${year}-${month}`;
  // A fiscal year is named after the calendar year it starts in.
  const startedLastYear = Number(month) < fiscalStart;
  const fiscalYear = startedLastYear ? Number(year) - 1 : Number(year);
  return `FY${fiscalYear}`;
}

/** A metadata text as a tag of this facet, slugged and cut to fit, or null if nothing is left. */
function textTag(facet: Facet, text: string): Tag | null {
  const prefix = `${facet.id}:`;
  const tag = fitTag(prefix + slug(text));
  const hasValue = tag.length > prefix.length;
  return hasValue ? tag : null;
}

/** The tag of a `field` facet, copied from metadata and cleaned, or null. */
export function derive(
  facet: Facet,
  state: Pick<FileState, 'metadata'>,
  config: Config,
): Tag | null {
  if (facet.kind !== 'field' || facet.field === undefined) return null;
  const metadataValue = state.metadata[facet.field];
  if (metadataValue === undefined) return null;
  if (facet.format) {
    const date = dateTagValue(String(metadataValue), facet.format, config.fiscal_year_start);
    return date && `${facet.id}:${date}`;
  }
  if (typeof metadataValue === 'boolean') return metadataValue ? `flag:${facet.id}` : null;
  const text = String(metadataValue);
  // A `to` field can list many recipients, and a single-valued tag can name only one.
  const firstRecipient = text.split(/[,;]/)[0] ?? '';
  return textTag(facet, facet.field === 'to' ? firstRecipient : text);
}

/** A tag an answer proposes, and whether it may be applied without a person's review. */
interface Candidate {
  facet: Facet;
  tag: Tag;
  confidence: number | null;
  autoApply: boolean;
}

/** Likelier first. Unknown confidence sorts last. */
const byConfidence = (a: Candidate, b: Candidate) => (b.confidence ?? -1) - (a.confidence ?? -1);
/** Alphabetical, so that ties sort the same way every run. */
function byText(a: Candidate, b: Candidate): number {
  if (a.tag === b.tag) return 0;
  return a.tag < b.tag ? -1 : 1;
}

/** Heavier facets first, then the likelier answer, then by text so ties are stable. */
const byRank = (a: Candidate, b: Candidate) =>
  b.facet.weight - a.facet.weight || byConfidence(a, b) || byText(a, b);

/** Keeps the likeliest candidate per tag, and the top labels of each `multi`. */
function keepLikeliest(candidates: Candidate[]): Candidate[] {
  const bestByTag = new Map<Tag, Candidate>();
  const sorted = candidates.toSorted((a, b) => byConfidence(a, b) || byText(a, b));
  const keptPerFacet = new Map<string, number>();
  for (const candidate of sorted) {
    if (bestByTag.has(candidate.tag)) continue;
    const kept = keptPerFacet.get(candidate.facet.id) ?? 0;
    if (candidate.facet.kind === 'multi' && kept >= MULTI_LABELS_KEPT) continue;
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
  const currentLabel = facet.aliases?.[value] ?? value;
  const tag = tagFor(facet, currentLabel);
  const mustReview = confidence === null || (estimated && thresholds.estimated_to_review);
  const applyAt = facet.apply_above ?? thresholds.apply;
  const autoApply = !mustReview && confidence >= applyAt;
  return { facet, tag, confidence, autoApply };
}

/** The tags a file has, the ones a person rejected for it, and those derived from metadata. */
interface HeldTags {
  existing: Tag[];
  rejected: Tag[];
  derived?: Tag[];
}

/** Every tag the answers and `derived` could add, leaving out what the held tags block. */
function gatherCandidates(
  answers: Answer[],
  facets: Facet[],
  thresholds: Config['thresholds'],
  { existing, rejected, derived = [] }: HeldTags,
): Candidate[] {
  const facetsById = new Map(facets.map((facet) => [facet.id, facet]));
  const alreadyHasValue = (facet: Facet) =>
    SINGLE_VALUED.has(facet.kind) && existing.some((held) => held.startsWith(`${facet.id}:`));
  const isBlocked = (facet: Facet, tag: Tag) =>
    rejected.includes(tag) || existing.includes(tag) || alreadyHasValue(facet);

  const candidates: Candidate[] = [];
  for (const answer of answers) {
    const facet = facetsById.get(answer.facet);
    const candidate = facet && answerCandidate(facet, answer, thresholds);
    if (candidate && !isBlocked(candidate.facet, candidate.tag)) candidates.push(candidate);
  }
  for (const tag of derived) {
    const facet = facetsById.get(tagFacet(tag));
    if (facet && !isBlocked(facet, tag)) {
      candidates.push({ facet, tag, confidence: 1, autoApply: true });
    }
  }
  return candidates;
}

const notName = (tag: Tag) => !isName(tag);

/** What a file's answers come to: tags to apply now, and tags for a person to review. */
interface Resolution {
  apply: Tag[];
  review: { tag: Tag; confidence: number | null }[];
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
): Resolution {
  const candidates = gatherCandidates(answers, facets, config.thresholds, tags);
  const ranked = keepLikeliest(candidates).toSorted(byRank);
  // Proper names do not count towards `max_tags`, so they are never crowded out.
  const freeSlots = Math.max(config.max_tags - tags.existing.filter(notName).length, 0);
  const toApply = ranked.filter(({ autoApply }) => autoApply).map(({ tag }) => tag);
  const toReview = ranked.filter(({ autoApply }) => !autoApply);
  return {
    apply: [...toApply.filter(isName), ...toApply.filter(notName).slice(0, freeSlots)],
    review: toReview.map(({ tag, confidence }) => ({ tag, confidence })),
  };
}
