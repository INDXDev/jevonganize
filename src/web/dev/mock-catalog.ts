/** The mock's answers about tags as a whole: the topic catalog, vocabulary, clean-up and refresh. */
import type { VocabularyEntry } from '../../types.ts';
import type { ToolMap } from '../../tool-map.ts';
import { files } from './mock-files.ts';

/** The provider and model every mock answer claims. */
export const MODEL = { provider: 'openai', model: 'gpt-6-luna' } as const;

/** A few topics from the real catalog's paths, enough to search. */
const CATALOG_TOPICS = [
  'finance/budgeting',
  'finance/invoices',
  'finance/tax-returns',
  'technology/machine-learning',
];

/** One active topic and one a model proposed, so both states show. */
const vocabularyEntries: VocabularyEntry[] = [
  { facet: 'topic', value: 'finance', state: 'active' },
  { facet: 'topic', value: 'zeppelins', state: 'proposed' },
];

/** Stands in for `search_catalog`. */
export const searchCatalog = ({ text }: ToolMap['search_catalog'][0]) =>
  CATALOG_TOPICS.filter((value) => value.includes(text));

/** Stands in for `pick_topics`: a long list, to show how the picker copes with one. */
export const pickTopics = () => ({
  topics: Array.from({ length: 100 }, (_, index) => ({
    value: `finance/topic-${index}`,
    probability: 0.97,
  })),
  files: 12,
  tokens: 250_000,
  cost_usd: 0.025,
});

/** Stands in for `list_vocabulary`. */
export const listVocabulary = ({ facet }: ToolMap['list_vocabulary'][0]) =>
  vocabularyEntries.filter((entry) => !facet || entry.facet === facet);

/** Stands in for `set_vocabulary`. Only values already known change state. */
export function setVocabulary({ facet, value, state }: ToolMap['set_vocabulary'][0]) {
  const entry = vocabularyEntries.find((known) => known.facet === facet && known.value === value);
  if (entry) entry.state = state;
}

/** Stands in for `cleanup_report`, with one finding of each kind. */
export const cleanupReport = () => ({
  near_duplicates: [
    { tags: ['topic:finance', 'topic:finances'], files: 23 },
    { tags: ['vendor:lumen-co', 'vendor:lumen'], files: 8 },
  ],
  single_use: [
    { tag: 'topic:zeppelins', facet: 'topic', count: 1 },
    { tag: 'place:reykjavik', facet: 'place', count: 1 },
  ],
  over_broad: [{ tag: 'topic:finance', facet: 'topic', count: 812 }],
  redundant_parents: [{ tag: 'topic:finance/tax', parent: 'topic:finance', files: 4 }],
});

/** At most this many candidates, so the refresh list fits on one screen. */
const MAX_CANDIDATES = 12;
/** What asking one facet about one candidate costs, smaller than a full organize. */
const REFRESH_TOKENS_PER_FILE = 2100;
const REFRESH_COST_PER_FILE_USD = 0.0002;

/** Made-up evidence for the candidate at `rank`, varied so every kind of signal shows. */
const signalsAt = (rank: number) => ({
  terms: ['invoice', 'total'].slice(0, 1 + (rank % 2)),
  tags: rank % 3 === 0 ? ['party:acme'] : [],
  similar: rank % 2 ? 0.4 : 0,
  name: rank % 4 === 0,
});

/** Stands in for `refresh_candidates`: untagged files, with signals that vary row by row. */
export function refreshCandidates({ tag, limit = 50 }: ToolMap['refresh_candidates'][0]) {
  const candidates = files
    .filter((file) => !file.tags.includes(tag))
    .slice(0, Math.min(limit, MAX_CANDIDATES))
    .map((file, rank) => ({ ...file, score: 0.9 - rank * 0.05, signals: signalsAt(rank) }));
  return {
    tag,
    tagged: 14,
    seeds: 14,
    terms: ['invoice', 'total', 'due'],
    tags: ['party:acme'],
    candidates,
    checked: 3,
    estimate: {
      files: candidates.length,
      cached: 0,
      facets: 1,
      tokens: candidates.length * REFRESH_TOKENS_PER_FILE,
      cost_usd: candidates.length * REFRESH_COST_PER_FILE_USD,
      ...MODEL,
    },
  };
}
