/**
 * Refreshing a tag: find files that lack it but look like the files that have it, ask the decision
 * model one yes-or-no question about each, and queue the hits for review. It writes no tag. A person
 * accepts a review item, which builds a plan, and `apply_plan` writes it.
 *
 * Finding candidates is local and free: characteristic words of the tagged files' text, tags that
 * go with this one, and the files most similar to tagged ones. Only checking them calls a model.
 */
import { lstat } from 'node:fs/promises';
import pLimit from 'p-limit';
import { answerKey, cachedAnswer, decide } from '../ai/decide.ts';
import { estimateCost } from '../ai/pricing.ts';
import { modelTarget, type ModelTarget, type ResolvedModel } from '../ai/providers.ts';
import { extractFile, isFailed } from '../extract/index.ts';
import type {
  Estimate,
  Facet,
  FileRow,
  RefreshCandidate,
  RefreshCandidates,
  RefreshSignals,
  Tag,
} from '../types.ts';
import { type Config, errorMessage, UserError } from './config.ts';
import type { Db } from './db.ts';
import type { RefreshScope } from './db/tag-refresh.ts';
import { fileTokens } from './estimate.ts';
import { loadFacets, tagFacet, toQuestions } from './facets.ts';
import { refusedPathTest } from './organize.ts';
import type { JobRun } from './plans.ts';

/** Candidates a refresh checks unless told otherwise. */
export const REFRESH_LIMIT = 50;
/** The most a refresh checks in one run. */
export const REFRESH_MAX = 200;
/** Tagged files the search learns from, the most recently modified first. */
const SEEDS = 200;
/** Tagged files whose nearest neighbours are looked up. Each lookup ranks the whole index. */
const NEIGHBOUR_SEEDS = 10;
const NEIGHBOURS_EACH = 50;
/** Rows each signal contributes before they are combined. */
const SIGNAL_ROWS = 500;
/** Words of the seeds counted across the index, and the best of them searched for. */
const TERM_POOL = 48;
const TERMS = 8;
const CO_TAGS = 20;
/** Trigram FTS finds nothing shorter. A long run of letters is rarely a word. */
const MIN_TERM_CHARS = 3;
const MAX_TERM_CHARS = 32;
/** How much each signal counts. Text says most, a file name least. */
const WEIGHTS = { text: 0.4, tags: 0.3, similar: 0.2, name: 0.1 };
/** The facet kinds that hold one value per file, so another value rules a file out. */
const SINGLE_VALUED = new Set<Facet['kind']>(['choice', 'level', 'date', 'field']);
/** The id the refresh question is stored under in the answer cache. */
const QUESTION_ID = 'refresh';

const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
const PLAIN_WORD = /^[\p{L}\p{N}]+$/u;
const NUMBER = /^\p{N}+$/u;

/** Han and katakana: compound nouns in Japanese and Chinese are runs of these, split by a segmenter. */
const COMPOUND_PART = /^[\p{sc=Han}\p{sc=Katakana}ー]+$/u;

/**
 * Lowercase words of letters and digits, which are safe in an FTS string. Trigram search needs
 * three characters, and most Japanese and Chinese words have two, so adjacent Han or katakana
 * words are also joined: 請求 and 書 give 請求書.
 */
export function wordsOf(text: string, minChars = MIN_TERM_CHARS): Set<string> {
  const found = new Set<string>();
  const add = (word: string) => {
    const length = Array.from(word).length;
    if (length >= minChars && length <= MAX_TERM_CHARS) found.add(word);
  };
  let previous: { segment: string; end: number } | undefined;
  for (const { segment, index, isWordLike } of segmenter.segment(text.toLowerCase())) {
    if (!isWordLike || !PLAIN_WORD.test(segment) || NUMBER.test(segment)) {
      previous = undefined;
      continue;
    }
    add(segment);
    const compound = COMPOUND_PART.test(segment);
    if (compound && previous?.end === index) add(previous.segment + segment);
    previous = compound ? { segment, end: index + segment.length } : undefined;
  }
  return found;
}

/** The facet a tag is a label of, if any, and the question that asks whether a file fits it. */
export interface RefreshQuestion {
  /** A `flag` facet that exists only to be asked and cached. It never becomes a tag. */
  facet: Facet;
  /** The facet the tag belongs to. */
  owner?: Facet;
  scope: RefreshScope;
}

function labelOf(tag: Tag, owner: Facet): string | undefined {
  if (owner.kind === 'flag') return undefined;
  return tag.slice(owner.id.length + 1);
}

/** What the tag means, in the owner facet's own trusted words. */
function meaning(tag: Tag, owner: Facet | undefined): string {
  if (!owner?.instructions) return '';
  if (owner.kind === 'flag') return ` The tag means the answer is yes to: ${owner.instructions}`;
  const label = labelOf(tag, owner) ?? '';
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
  const instructions =
    `Should this file carry the tag ${JSON.stringify(tag)}? Answer yes only if the tag clearly fits what the file itself is or contains.` +
    meaning(tag, owner);
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
  const single = owner && owner.kind !== 'flag' && SINGLE_VALUED.has(owner.kind);
  return { facet, owner, scope: { tag, ...(single && { facet: owner.id }) } };
}

/** Words of the seeds' text that are common among them and rare across the index, weighted. */
function characteristicTerms(db: Db, seeds: number[]): [string, number][] {
  const seedDf = new Map<string, number>();
  let withText = 0;
  for (const id of seeds) {
    const text = db.getContent(id);
    if (!text) continue;
    withText++;
    for (const word of wordsOf(text)) seedDf.set(word, (seedDf.get(word) ?? 0) + 1);
  }
  if (withText === 0) return [];
  const least = withText >= 4 ? 2 : 1;
  const pool = [...seedDf]
    .filter(([, n]) => n >= least)
    .toSorted(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .slice(0, TERM_POOL);
  const { docs, df } = db.contentFrequencies(pool.map(([term]) => term));
  return pool
    .map(([term, n]): [string, number] => {
      const rarity = Math.log(docs / Math.max(df.get(term) ?? 1, 1));
      return [term, (n / withText) * rarity];
    })
    .filter(([, weight]) => weight > 0)
    .toSorted(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .slice(0, TERMS);
}

/**
 * Tags that go with this one: on its files more often than chance (lift above 1), weighted by
 * how often they go with it and by the IDF that similarity uses.
 */
function coTagWeights(db: Db, tag: Tag, tagged: number): [Tag, number][] {
  if (tagged === 0) return [];
  const { files, rows } = db.coTagCounts(tag);
  const least = tagged >= 4 ? 2 : 1;
  return rows
    .filter(({ co, df }) => co >= least && (co * files) / (tagged * df) > 1)
    .map(({ tag: name, co, df, weight }): [Tag, number] => {
      const idf = Math.log(1 + (files - df + 0.5) / (df + 0.5));
      return [name, (co / tagged) * idf * weight];
    })
    .filter(([, weight]) => weight > 0)
    .toSorted(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .slice(0, CO_TAGS);
}

/** The highest similarity of each untagged neighbour of the first seeds. */
function neighbours(db: Db, scope: RefreshScope, seeds: number[]): Map<number, number> {
  const best = new Map<number, number>();
  for (const seed of seeds.slice(0, NEIGHBOUR_SEEDS)) {
    for (const { id, score } of db.similarFiles(seed, NEIGHBOURS_EACH)) {
      best.set(id, Math.max(best.get(id) ?? 0, score));
    }
  }
  const out = db.refreshExcluded(scope, [...best.keys()]);
  for (const id of out) best.delete(id);
  return best;
}

/** One file's signals while they are gathered. */
interface Gathered {
  text: number;
  terms: string[];
  tags: Tag[];
  tagScore: number;
  similar: number;
  name: boolean;
}

/** Every file any signal points at, with what each one says. */
function gather(db: Db, scope: RefreshScope, seeds: number[], tagged: number) {
  const terms = characteristicTerms(db, seeds);
  const valueWords = [...wordsOf(scope.tag.slice(scope.tag.indexOf(':') + 1))];
  // The tag's own words count as much as the best word of its files.
  const top = terms[0]?.[1] ?? 1;
  const searched = new Map([...valueWords.map((word): [string, number] => [word, top]), ...terms]);
  const textTotal = [...searched.values()].reduce((sum, weight) => sum + weight, 0);
  const weights = coTagWeights(db, scope.tag, tagged);
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  const files = new Map<number, Gathered>();
  const entry = (id: number) => {
    let found = files.get(id);
    if (!found) {
      found = { text: 0, terms: [], tags: [], tagScore: 0, similar: 0, name: false };
      files.set(id, found);
    }
    return found;
  };
  // FTS finds the files, and the share of the weighted words each holds scores them. BM25 alone
  // says little in a small index, where common words get almost no weight.
  for (const { id } of db.contentCandidates(scope, [...searched.keys()], SIGNAL_ROWS)) {
    const text = db.getContent(id)?.toLowerCase() ?? '';
    const held = [...searched].filter(([word]) => text.includes(word));
    const file = entry(id);
    file.text = held.reduce((sum, [, weight]) => sum + weight, 0) / textTotal;
    file.terms = held.map(([word]) => word).filter((word) => !valueWords.includes(word));
  }
  for (const { id, score, tags } of db.coTagCandidates(scope, weights, SIGNAL_ROWS)) {
    Object.assign(entry(id), { tags, tagScore: total > 0 ? score / total : 0 });
  }
  for (const [id, score] of neighbours(db, scope, seeds)) entry(id).similar = score;
  for (const id of db.nameCandidates(scope, valueWords, SIGNAL_ROWS)) entry(id).name = true;
  return { terms: terms.map(([term]) => term), tags: weights.map(([name]) => name), files };
}

const combined = ({ text, tagScore, similar, name }: Gathered) =>
  Math.round(
    (WEIGHTS.text * text +
      WEIGHTS.tags * tagScore +
      WEIGHTS.similar * similar +
      WEIGHTS.name * (name ? 1 : 0)) *
      1e6,
  ) / 1e6;

/** Which files already have a valid cached answer to the question, for their stored state. */
function checkedTest(db: Db, target: ModelTarget, facet: Facet) {
  return (rows: { id: number; state_hash: string | null }[]) => {
    const keys = new Map(
      rows.flatMap(({ id, state_hash }) =>
        state_hash ? [[id, answerKey(target, facet, state_hash)] as const] : [],
      ),
    );
    const stored = db.getAnswers([...keys.values()]);
    const store = { getAnswer: (key: string) => stored.get(key) };
    return new Set(
      [...keys].filter(([, key]) => cachedAnswer(store, key, facet)).map(([id]) => id),
    );
  };
}

/** What checking these files once would cost, from the index alone. */
function estimateCheck(config: Config, target: ModelTarget, facet: Facet, files: FileRow[]) {
  const questionChars = JSON.stringify(toQuestions(facet)).length;
  const tokens = files.reduce((sum, file) => sum + fileTokens(config, file, questionChars), 0);
  const estimate: Estimate = {
    files: files.length,
    cached: 0,
    facets: 1,
    tokens,
    cost_usd: estimateCost(tokens, target),
    provider: target.provider,
    model: target.modelId,
  };
  return estimate;
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
  const found = gather(db, scope, seeds, tagged);
  const isRefused = refusedPathTest(db, config);
  const rows = db.refreshRows([...found.files.keys()]).filter((row) => !isRefused(row.path));
  const checked = checkedTest(db, target, facet)(rows);
  const ranked = rows
    .filter((row) => !checked.has(row.id))
    .map((row) => {
      const gathered = found.files.get(row.id)!;
      return { row, gathered, score: combined(gathered) };
    })
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || a.row.id - b.row.id)
    .slice(0, Math.min(limit, REFRESH_MAX));
  const candidates = ranked.map(({ row, gathered, score }): RefreshCandidate => {
    const { state_hash: _state, ...file } = row;
    const signals: RefreshSignals = {
      terms: gathered.terms,
      tags: gathered.tags,
      similar: Math.round(gathered.similar * 1e6) / 1e6,
      name: gathered.name,
    };
    return { ...file, score, signals };
  });
  return {
    tag,
    tagged,
    seeds: seeds.length,
    terms: found.terms,
    tags: found.tags,
    candidates,
    checked: checked.size,
    estimate: estimateCheck(config, target, facet, candidates),
  };
}

/** Why a candidate is in the review queue, in a few words. Every part is computed locally. */
export function refreshReason({ signals }: Pick<RefreshCandidate, 'signals'>): string {
  const parts = [
    ...(signals.terms.length ? [`words ${signals.terms.slice(0, 3).join(', ')}`] : []),
    ...(signals.tags.length ? [`tags ${signals.tags.slice(0, 3).join(', ')}`] : []),
    ...(signals.similar > 0 ? ['similar files'] : []),
    ...(signals.name ? ['file name'] : []),
  ];
  return `Refresh: ${parts.join('; ') || 'like the tagged files'}`;
}

/** What a refresh run works with. */
export interface RefreshSetup {
  db: Db;
  config: Config;
  question: RefreshQuestion;
  model: ResolvedModel;
  candidates: RefreshCandidate[];
}

/** What a run has found so far. */
interface RefreshTally {
  done: number;
  failed: number;
  tokens: number;
  cost: number | null;
  warnings: string[];
  hits: { candidate: RefreshCandidate; confidence: number }[];
  fatal?: UserError;
}

function addTokens(tally: RefreshTally, tokens: number, model: ResolvedModel): void {
  tally.tokens += tokens;
  const price = estimateCost(tokens, model);
  tally.cost = tally.cost === null || price === null ? null : tally.cost + price;
}

/** Reads one candidate and asks about it. A hit waits in the tally until the run ends. */
async function checkOne(
  setup: RefreshSetup,
  candidate: RefreshCandidate,
  tally: RefreshTally,
  modelLimit: ReturnType<typeof pLimit>,
): Promise<void> {
  const { db, config, question, model } = setup;
  const info = await lstat(candidate.path);
  if (!info.isFile()) throw new Error('not a regular file');
  const state = await extractFile(candidate.path, config);
  if (isFailed(state)) throw new Error(state.warnings.join('; '));
  db.setContent(candidate.id, state.text);
  const onTokens = (tokens: number) => addTokens(tally, tokens, model);
  const result = await modelLimit(() => decide({ state, onTokens }, [question.facet], model, db));
  const answer = result.answers.find((row) => row.facet === question.facet.id);
  const confidence = answer?.value === 'yes' ? answer.confidence : null;
  if (confidence !== null && confidence >= config.thresholds.review) {
    tally.hits.push({ candidate, confidence });
  }
}

/** Stores the hits as review items, skipping files that gained the tag or a review meanwhile. */
function storeHits({ db, question }: RefreshSetup, tally: RefreshTally): number {
  const ids = tally.hits.map(({ candidate }) => candidate.id);
  return db.transaction(() => {
    const out = db.refreshExcluded(question.scope, ids);
    let added = 0;
    for (const { candidate, confidence } of tally.hits) {
      if (out.has(candidate.id)) continue;
      const item = { file_id: candidate.id, kind: 'suggest' as const, tag: question.scope.tag };
      if (db.addReview({ ...item, confidence, reason: refreshReason(candidate) })) added++;
    }
    return added;
  });
}

/**
 * Checks each candidate with the decision model and queues the hits for review. A rejected key
 * stops the run, and anything else fails one file. A cancelled run stores no review item.
 */
export async function refreshFiles(setup: RefreshSetup, run: JobRun): Promise<void> {
  const { db, config, candidates } = setup;
  const tally: RefreshTally = { done: 0, failed: 0, tokens: 0, cost: 0, warnings: [], hits: [] };
  const isRefused = refusedPathTest(db, config);
  const modelLimit = pLimit(config.concurrency);
  const fileLimit = pLimit(config.concurrency * 2);
  run.update({ total: candidates.length });
  const checkRow = async (candidate: RefreshCandidate) => {
    if (run.signal.aborted || tally.fatal) return;
    run.update({ current: candidate.path });
    try {
      if (isRefused(candidate.path)) tally.warnings.push(`Skipped ${candidate.path}: excluded`);
      else await checkOne(setup, candidate, tally, modelLimit);
    } catch (error) {
      if (error instanceof UserError) tally.fatal ??= error;
      else {
        tally.failed++;
        tally.warnings.push(`${candidate.path}: ${errorMessage(error)}`);
      }
    }
    run.update({ done: ++tally.done, tokens: tally.tokens, cost_usd: tally.cost });
  };
  await Promise.all(candidates.map((candidate) => fileLimit(() => checkRow(candidate))));
  if (tally.fatal) throw tally.fatal;
  run.signal.throwIfAborted();
  const reviews = storeHits(setup, tally);
  run.update({ reviews, failed: tally.failed, warnings: tally.warnings, tokens: tally.tokens });
}
