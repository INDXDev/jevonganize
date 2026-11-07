/**
 * Refreshing a tag: find files that lack it but look like the files that have it, ask the decision
 * model one yes-or-no question about each, and queue the hits for review. It writes no tag.
 *
 * This module finds the candidates and words the question. Finding is local and free: it ranks by
 * the signals in refresh-signals.ts. Only checking them, in refresh-check.ts, calls a model.
 */
import { answerKey, cachedAnswer } from '../ai/decide.ts';
import { estimateCost } from '../ai/pricing.ts';
import { modelTarget, type ModelTarget } from '../ai/providers.ts';
import type {
  Estimate,
  Facet,
  FileRow,
  RefreshCandidate,
  RefreshCandidates,
  Tag,
} from '../types.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { RefreshScope } from './db/refresh-scope.ts';
import { fileTokens } from './estimate.ts';
import { toQuestions } from './facet-questions.ts';
import { loadFacets, tagFacet } from './facets.ts';
import { refusedPathTest } from './organize-setup.ts';
import { combinedScore, type FileSignals, gatherSignals, roundScore } from './refresh-signals.ts';

/** Candidates a refresh checks unless told otherwise. */
export const REFRESH_LIMIT = 50;
/** The most a refresh checks in one run. */
export const REFRESH_MAX = 200;
/** Tagged files the search learns from, the most recently modified first. */
const SEEDS = 200;
/** The facet kinds that hold one value per file, so another value rules a file out. */
const SINGLE_VALUED = new Set<Facet['kind']>(['choice', 'level', 'date', 'field']);
/** The id the refresh question is stored under in the answer cache. */
const QUESTION_ID = 'refresh';

/** The facet a tag is a label of, if any, and the question that asks whether a file fits it. */
export interface RefreshQuestion {
  /** A `flag` facet that exists only to be asked and cached. It never becomes a tag. */
  facet: Facet;
  /** The facet the tag belongs to. */
  owner?: Facet;
  scope: RefreshScope;
}

/** A file the index points at, as `refreshRows` returns it. */
type IndexedRow = FileRow & { state_hash: string | null };

/** What the tag means, in the owner facet's own trusted words. */
function tagMeaning(tag: Tag, owner: Facet | undefined): string {
  if (!owner?.instructions) return '';
  if (owner.kind === 'flag') return ` The tag means the answer is yes to: ${owner.instructions}`;
  const label = tag.slice(owner.id.length + 1);
  const definition = owner.values?.[label];
  const defined = definition ? ` That answer means: ${definition}` : '';
  return ` The tag is the answer ${JSON.stringify(label)} to: ${owner.instructions}${defined}`;
}

/**
 * The one question a refresh asks. Its text covers the tag and its facet's definition, so the
 * answer key changes when either does. The tag is quoted: it may come from a file, and the answer
 * can only be a probability.
 */
export async function refreshQuestion(config: Config, tag: Tag): Promise<RefreshQuestion> {
  const owner = (await loadFacets(config)).find((facet) => facet.id === tagFacet(tag));
  const question = `Should this file carry the tag ${JSON.stringify(tag)}? Answer yes only if the tag clearly fits what the file itself is or contains.`;
  const instructions = question + tagMeaning(tag, owner);
  const facet: Facet = {
    id: QUESTION_ID,
    pack: QUESTION_ID,
    title: tag,
    kind: 'flag',
    instructions,
    applies_to: [],
    weight: 0,
    ...(owner?.profile !== undefined && { profile: owner.profile }),
  };
  // A file with another value of a single-valued facet already has its answer, so it is left out.
  const isSingleValued = owner && owner.kind !== 'flag' && SINGLE_VALUED.has(owner.kind);
  return { facet, owner, scope: { tag, ...(isSingleValued && { facet: owner.id }) } };
}

/** The ids of the rows that already have a valid cached answer to the question, for their state. */
function alreadyChecked(db: Db, target: ModelTarget, facet: Facet, rows: IndexedRow[]) {
  const keyById = new Map<number, string>();
  for (const { id, state_hash } of rows) {
    if (state_hash) keyById.set(id, answerKey(target, facet, state_hash));
  }
  const stored = db.getAnswers([...keyById.values()]);
  const store = { getAnswer: (key: string) => stored.get(key) };
  const checkedIds = [...keyById]
    .filter(([, key]) => cachedAnswer(store, key, facet))
    .map(([id]) => id);
  return new Set(checkedIds);
}

/** What checking these files once would cost, from the index alone. */
function estimateCheck(
  config: Config,
  target: ModelTarget,
  facet: Facet,
  files: FileRow[],
): Estimate {
  const questionChars = JSON.stringify(toQuestions(facet)).length;
  const tokens = files.reduce((sum, file) => sum + fileTokens(config, file, questionChars), 0);
  return {
    files: files.length,
    cached: 0,
    facets: 1,
    tokens,
    // Input only, as in `estimate`.
    cost_usd: estimateCost({ input: tokens, output: 0 }, target),
    provider: target.provider,
    model: target.modelId,
  };
}

/** A ranked row as `refresh_candidates` reports it, without its state hash. */
function toCandidate(row: IndexedRow, signals: FileSignals, score: number): RefreshCandidate {
  const { state_hash: _stateHash, ...file } = row;
  const { terms, tags, similar, name } = signals;
  return { ...file, score, signals: { terms, tags, similar: roundScore(similar), name } };
}

/** The `limit` best-scoring rows as candidates. Ties go to the lower id, so the order is stable. */
function bestCandidates(
  rows: IndexedRow[],
  signalsById: Map<number, FileSignals>,
  limit: number,
): RefreshCandidate[] {
  const scored = rows.map((row) => {
    const signals = signalsById.get(row.id)!;
    return { row, signals, score: combinedScore(signals) };
  });
  return scored
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || a.row.id - b.row.id)
    .slice(0, Math.min(limit, REFRESH_MAX))
    .map(({ row, signals, score }) => toCandidate(row, signals, score));
}

/**
 * Ranks the files that lack a tag but look like those that have it. Calls no model and sends
 * nothing. Files already checked with unchanged content, and paths that may not be read, are out.
 */
export async function findCandidates(
  db: Db,
  config: Config,
  tag: Tag,
  limit = REFRESH_LIMIT,
): Promise<RefreshCandidates> {
  const { facet, scope } = await refreshQuestion(config, tag);
  const target = modelTarget(config, facet.profile);
  const { ids: seeds, total: tagged } = db.refreshSeeds(tag, SEEDS);
  const gathered = gatherSignals(db, scope, seeds, tagged);

  const isRefused = refusedPathTest(db, config);
  const rows = db.refreshRows([...gathered.files.keys()]).filter((row) => !isRefused(row.path));
  const checked = alreadyChecked(db, target, facet, rows);
  const unchecked = rows.filter((row) => !checked.has(row.id));
  const candidates = bestCandidates(unchecked, gathered.files, limit);

  return {
    tag,
    tagged,
    seeds: seeds.length,
    terms: gathered.terms,
    tags: gathered.tags,
    candidates,
    checked: checked.size,
    estimate: estimateCheck(config, target, facet, candidates),
  };
}
