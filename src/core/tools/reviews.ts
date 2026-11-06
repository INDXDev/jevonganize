/**
 * Review items, the vocabulary of open facets, and tag cleanup. A review item is a tag waiting for
 * a person: accepting one only builds a plan. An open facet can grow new values, which start as
 * proposed vocabulary and turn active when a person accepts them.
 */
import { z } from 'zod';
import { resolveChatModel, resolveModel } from '../../ai/providers.ts';
import { suggest } from '../../ai/suggest.ts';
import { extractFile, isFailed } from '../../extract/index.ts';
import type { CleanupReport, Facet, Plan, ReviewItem, Tag, TagCount } from '../../types.ts';
import { type Config, UserError } from '../config.ts';
import type { Db } from '../db.ts';
import { loadFacets, tagFacet } from '../facets.ts';
import { proposeReviews } from '../plans.ts';
import {
  type Context,
  emitReviews,
  fileId,
  nothing,
  planSource,
  servableFile,
  tag,
  type ToolTable,
} from './shared.ts';

/** A tag on more than this share of the files says little about any of them. */
const OVER_BROAD_SHARE = 0.5;
/** Below this many files a share proves nothing. */
const OVER_BROAD_MIN_FILES = 10;
/** Keeps the prompt to a known size, with the most used tags first. */
const VOCABULARY_SHOWN = 500;

const lettersAndDigits = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** What is after the first colon of a tag. */
const tagValue = (name: Tag) => name.slice(name.indexOf(':') + 1);

const reviewIds = (items: ReviewItem[]) => items.map((item) => item.id);

async function openFacetsOf(config: Config): Promise<Facet[]> {
  return (await loadFacets(config)).filter((facet) => facet.open);
}

/** Same facet, and labels equal but for punctuation, or one extending the other. */
// shortcut: compares every pair, group by facet if tag counts reach the tens of thousands.
function nearDuplicates(counts: TagCount[]): CleanupReport['near_duplicates'] {
  const rows = counts.map((row) => ({
    ...row,
    facet: tagFacet(row.tag),
    bare: lettersAndDigits(row.tag),
    extensionPrefix: `${row.tag}-`,
  }));
  const found: CleanupReport['near_duplicates'] = [];
  rows.forEach((a, index) => {
    for (let next = index + 1; next < rows.length; next++) {
      const b = rows[next]!;
      const near =
        a.bare === b.bare ||
        a.tag.startsWith(b.extensionPrefix) ||
        b.tag.startsWith(a.extensionPrefix);
      if (near && a.facet === b.facet) {
        found.push({ tags: [a.tag, b.tag], files: a.count + b.count });
      }
    }
  });
  return found;
}

function overBroadTags(counts: TagCount[], files: number): TagCount[] {
  if (files < OVER_BROAD_MIN_FILES) return [];
  return counts.filter(({ count }) => count / files > OVER_BROAD_SHARE);
}

function cleanupReport(db: Db): CleanupReport {
  const counts = db.tagCounts();
  const { files } = db.stats();
  return {
    near_duplicates: nearDuplicates(counts),
    single_use: counts.filter(({ count }) => count === 1),
    over_broad: overBroadTags(counts, files),
  };
}

/** The items of `ids` that nobody has settled yet. */
function pendingReviews(db: Db, ids: number[]): ReviewItem[] {
  const isPending = (item: ReviewItem) =>
    db.reviewsForFile(item.file_id).some((other) => other.id === item.id);
  return db.reviewsByIds(ids).filter(isPending);
}

/** Settles items as accepted: their values join the vocabulary, and their tags join a plan. */
async function acceptReviews(ctx: Context, items: ReviewItem[]): Promise<Plan> {
  const { db } = ctx;
  const openFacets = await openFacetsOf(ctx.config);
  return db.transaction(() => {
    for (const item of items) {
      const id = tagFacet(item.tag);
      if (openFacets.some((facet) => facet.id === id)) {
        db.setVocabulary(id, tagValue(item.tag), 'active');
      }
    }
    db.resolveReviews(reviewIds(items), 'accepted');
    return proposeReviews(db, items, planSource(ctx));
  });
}

/** Tags the chat model must not suggest for a file. */
function refusedSuggestions(db: Db, id: number): string[] {
  const retired = db
    .listVocabulary()
    .filter((entry) => entry.state === 'retired')
    .map((entry) => `${entry.facet}:${entry.value}`);
  return [...retired, ...db.rejectedTags(id)];
}

/** Asks the chat model for tags for one file. Models are built first, so a missing key refuses. */
async function askForTags({ db, config }: Context, id: number, path: string): Promise<Tag[]> {
  const chat = await resolveChatModel(config);
  const verifier = await resolveModel(config);
  const state = await extractFile(path, config);
  if (isFailed(state)) throw new UserError(`${path}: ${state.warnings.join('; ')}`);
  const openFacets = await openFacetsOf(config);
  const vocabulary = db.tagCounts().slice(0, VOCABULARY_SHOWN);
  return suggest(
    state,
    vocabulary.map((row) => row.tag),
    chat,
    {
      openFacets: openFacets.map((facet) => facet.id),
      retired: refusedSuggestions(db, id),
      verifier,
    },
  );
}

/** Files suggested tags as review items, and their values as proposed vocabulary. */
function storeSuggestions(db: Db, id: number, tags: Tag[]): void {
  for (const name of tags) {
    db.proposeVocabulary(tagFacet(name), tagValue(name));
    const reason = 'Suggested by the chat model';
    db.addReview({ file_id: id, kind: 'suggest', tag: name, confidence: null, reason });
  }
}

/** The tools on reviews, vocabulary and cleanup. */
export const reviewTools = {
  list_reviews: {
    description: 'Items waiting for a person, by tag and then confidence.',
    input: z.strictObject({ tag: tag.optional(), limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    run: async (filter, { db }) => db.listReviews(filter),
  },

  resolve_reviews: {
    description: 'Accepts or rejects review items. Accepting only builds a plan.',
    input: z.strictObject({ ids: z.array(z.int().positive()), accept: z.boolean() }),
    writes: true,
    agent: true,
    approval: true,
    run: async ({ ids, accept }, ctx) => {
      const items = pendingReviews(ctx.db, ids);
      if (items.length === 0) return null;
      if (!accept) {
        ctx.db.resolveReviews(reviewIds(items), 'rejected');
        emitReviews(ctx);
        return null;
      }
      const plan = await acceptReviews(ctx, items);
      emitReviews(ctx);
      return plan;
    },
  },

  suggest_tags: {
    description:
      'Asks the chat model for new tags, as review items. Writes no tags, but sends file data to the provider and costs money.',
    input: z.strictObject({ id: fileId }),
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, ctx) => {
      const file = servableFile(ctx, id);
      if (!file) throw new UserError(`File ${id} is not in a library`);
      const tags = await askForTags(ctx, id, file.path);
      storeSuggestions(ctx.db, id, tags);
      emitReviews(ctx);
      return ctx.db.reviewsForFile(id).filter((item) => tags.includes(item.tag));
    },
  },

  set_vocabulary: {
    description: 'Activates or retires a value of an open facet.',
    input: z.strictObject({
      facet: z.string().min(1),
      value: z.string().min(1),
      state: z.enum(['active', 'retired']),
    }),
    writes: true,
    agent: false,
    run: async ({ facet, value, state }, { db, config }) => {
      const isOpen = (await openFacetsOf(config)).some((entry) => entry.id === facet);
      if (!isOpen) throw new UserError(`${facet} is not an open facet`);
      db.setVocabulary(facet, value, state);
    },
  },

  list_vocabulary: {
    description: 'Values of open facets, and whether each is active.',
    input: z.strictObject({ facet: z.string().optional() }),
    writes: false,
    agent: true,
    run: async ({ facet }, { db }) => db.listVocabulary(facet),
  },

  cleanup_report: {
    description: 'Near-duplicate tags, tags on one file, and over-broad tags.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { db }) => cleanupReport(db),
  },
} satisfies Partial<ToolTable>;
