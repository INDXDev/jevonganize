/**
 * The local signals a tag refresh ranks candidates by. Each one says how much an untagged file looks
 * like the files that carry the tag, the seeds:
 *
 * - text: the characteristic words of the seeds' text that the file holds,
 * - tags: the tags that go with this one that the file carries,
 * - similar: the file's highest similarity to a seed,
 * - name: whether a word of the tag's value is in the file name.
 *
 * All of it is computed from the index. Nothing here reads a file or calls a model.
 */
import type { Tag } from '../types.ts';
import type { Db } from './db.ts';
import type { RefreshScope } from './db/refresh-scope.ts';

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

const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
const PLAIN_WORD = /^[\p{L}\p{N}]+$/u;
const NUMBER = /^\p{N}+$/u;
/** Han and katakana: compound nouns in Japanese and Chinese are runs of these, split by a segmenter. */
const COMPOUND_PART = /^[\p{sc=Han}\p{sc=Katakana}ー]+$/u;

/** A word or tag with its weight. */
type Weighted = [string, number];

/** Heaviest first, then by name, so equal weights keep a stable order. */
const heaviestFirst = ([nameA, weightA]: Weighted, [nameB, weightB]: Weighted) =>
  weightB - weightA || (nameA < nameB ? -1 : 1);

const sumOfWeights = (weighted: Iterable<Weighted>) =>
  [...weighted].reduce((sum, [, weight]) => sum + weight, 0);

/** Rounds a score to six places, as candidates report it. */
export const roundScore = (score: number) => Math.round(score * 1e6) / 1e6;

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
  let previousPart: { segment: string; end: number } | undefined;
  for (const { segment, index, isWordLike } of segmenter.segment(text.toLowerCase())) {
    const isPlainWord = isWordLike && PLAIN_WORD.test(segment) && !NUMBER.test(segment);
    if (!isPlainWord) {
      previousPart = undefined;
      continue;
    }
    add(segment);
    const isCompoundPart = COMPOUND_PART.test(segment);
    if (isCompoundPart && previousPart?.end === index) add(previousPart.segment + segment);
    previousPart = isCompoundPart ? { segment, end: index + segment.length } : undefined;
  }
  return found;
}

/** What each signal says about one file. Every score is 0 to 1. */
export interface FileSignals {
  text: number;
  /** The characteristic words it holds, other than the tag's own. */
  terms: string[];
  /** The tags that go with this one that it carries. */
  tags: Tag[];
  tagScore: number;
  similar: number;
  name: boolean;
}

/** Every file any signal points at, and the words and tags the search used. */
export interface GatheredSignals {
  terms: string[];
  tags: Tag[];
  files: Map<number, FileSignals>;
}

/** Looks up a file's signals, starting it at zero on its first mention. */
type SignalsOf = (id: number) => FileSignals;

/** The words of a tag's value: `topic:finance/tax` gives `finance` and `tax`. */
const valueWordsOf = (tag: Tag) => [...wordsOf(tag.slice(tag.indexOf(':') + 1))];

/** Gathers every signal for a tag's scope, from its seeds. */
export function gatherSignals(
  db: Db,
  scope: RefreshScope,
  seeds: number[],
  taggedCount: number,
): GatheredSignals {
  const valueWords = valueWordsOf(scope.tag);
  const terms = characteristicTerms(db, seeds);
  const coTags = coTagWeights(db, scope.tag, taggedCount);

  const files = new Map<number, FileSignals>();
  const signalsOf: SignalsOf = (id) => {
    const existing = files.get(id);
    if (existing) return existing;
    const empty = { text: 0, terms: [], tags: [], tagScore: 0, similar: 0, name: false };
    files.set(id, empty);
    return empty;
  };
  scoreText(db, scope, { terms, valueWords }, signalsOf);
  scoreCoTags(db, scope, coTags, signalsOf);
  for (const [id, score] of neighbours(db, scope, seeds)) signalsOf(id).similar = score;
  for (const id of db.nameCandidates(scope, valueWords, SIGNAL_ROWS)) signalsOf(id).name = true;

  return { terms: terms.map(([term]) => term), tags: coTags.map(([coTag]) => coTag), files };
}

/** Words of the seeds' text that are common among them and rare across the index, weighted. */
function characteristicTerms(db: Db, seeds: number[]): Weighted[] {
  const seedsWithWord = new Map<string, number>();
  let seedsWithText = 0;
  for (const id of seeds) {
    const text = db.getContent(id);
    if (!text) continue;
    seedsWithText++;
    for (const word of wordsOf(text)) seedsWithWord.set(word, (seedsWithWord.get(word) ?? 0) + 1);
  }
  if (seedsWithText === 0) return [];
  // With a handful of seeds, a word in only one of them is as likely chance as character.
  const fewestSeeds = seedsWithText >= 4 ? 2 : 1;
  const pool = [...seedsWithWord]
    .filter(([, seedCount]) => seedCount >= fewestSeeds)
    .toSorted(heaviestFirst)
    .slice(0, TERM_POOL);
  const { docs: filesWithText, df: filesWithTerm } = db.contentFrequencies(
    pool.map(([term]) => term),
  );
  return pool
    .map(([term, seedCount]): Weighted => {
      const rarity = Math.log(filesWithText / Math.max(filesWithTerm.get(term) ?? 1, 1));
      return [term, (seedCount / seedsWithText) * rarity];
    })
    .filter(([, weight]) => weight > 0)
    .toSorted(heaviestFirst)
    .slice(0, TERMS);
}

/**
 * Tags that go with this one: on its files more often than chance (lift above 1), weighted by
 * how often they go with it and by the IDF that similarity uses.
 */
function coTagWeights(db: Db, tag: Tag, taggedCount: number): Weighted[] {
  if (taggedCount === 0) return [];
  const { files: indexedFiles, rows } = db.coTagCounts(tag);
  const fewestTogether = taggedCount >= 4 ? 2 : 1;
  const goesWithTag = ({ co: together, df: carrying }: { co: number; df: number }) => {
    const lift = (together * indexedFiles) / (taggedCount * carrying);
    return together >= fewestTogether && lift > 1;
  };
  return rows
    .filter(goesWithTag)
    .map(({ tag: coTag, co: together, df: carrying, weight }): Weighted => {
      const idf = Math.log(1 + (indexedFiles - carrying + 0.5) / (carrying + 0.5));
      return [coTag, (together / taggedCount) * idf * weight];
    })
    .filter(([, weight]) => weight > 0)
    .toSorted(heaviestFirst)
    .slice(0, CO_TAGS);
}

/**
 * The text signal: FTS finds the files, and the share of the weighted words each holds scores
 * them. BM25 alone says little in a small index, where common words get almost no weight.
 */
function scoreText(
  db: Db,
  scope: RefreshScope,
  { terms, valueWords }: { terms: Weighted[]; valueWords: string[] },
  signalsOf: SignalsOf,
): void {
  // The tag's own words count as much as the best word of its files.
  const bestWeight = terms[0]?.[1] ?? 1;
  const valueTerms = valueWords.map((word): Weighted => [word, bestWeight]);
  const searched = new Map([...valueTerms, ...terms]);
  const searchedWeight = sumOfWeights(searched);
  for (const { id } of db.contentCandidates(scope, [...searched.keys()], SIGNAL_ROWS)) {
    const text = db.getContent(id)?.toLowerCase() ?? '';
    const heldWords = [...searched].filter(([word]) => text.includes(word));
    const signals = signalsOf(id);
    signals.text = sumOfWeights(heldWords) / searchedWeight;
    signals.terms = heldWords.map(([word]) => word).filter((word) => !valueWords.includes(word));
  }
}

/** The tag signal: the share of the co-tags' weight that each file carries. */
function scoreCoTags(db: Db, scope: RefreshScope, coTags: Weighted[], signalsOf: SignalsOf): void {
  const coTagWeight = sumOfWeights(coTags);
  for (const { id, score, tags } of db.coTagCandidates(scope, coTags, SIGNAL_ROWS)) {
    const signals = signalsOf(id);
    signals.tags = tags;
    signals.tagScore = coTagWeight > 0 ? score / coTagWeight : 0;
  }
}

/** The similarity signal: the highest similarity of each untagged neighbour of the first seeds. */
function neighbours(db: Db, scope: RefreshScope, seeds: number[]): Map<number, number> {
  const best = new Map<number, number>();
  for (const seed of seeds.slice(0, NEIGHBOUR_SEEDS)) {
    for (const { id, score } of db.similarFiles(seed, NEIGHBOURS_EACH)) {
      best.set(id, Math.max(best.get(id) ?? 0, score));
    }
  }
  for (const id of db.refreshExcluded(scope, [...best.keys()])) best.delete(id);
  return best;
}

/** The signals weighted into one score, 0 to 1. */
export const combinedScore = ({ text, tagScore, similar, name }: FileSignals) =>
  roundScore(
    WEIGHTS.text * text +
      WEIGHTS.tags * tagScore +
      WEIGHTS.similar * similar +
      WEIGHTS.name * (name ? 1 : 0),
  );
