/**
 * The tools on review items, the vocabulary of open facets, and tag cleanup. A review item is a tag
 * waiting for a person: accepting one only builds a plan, and makes its value active vocabulary
 * when its facet is open.
 */
import { z } from 'zod';
import type { Plan, ReviewItem } from '../../types.ts';
import type { Db } from '../db.ts';
import { tagFacet } from '../facets.ts';
import { proposeReviews } from '../plans.ts';
import { cleanupReport } from './cleanup.ts';
import {
  type Context,
  emitReviews,
  fileId as fileIdInput,
  nothing,
  planSource,
  tag as tagInput,
  type ToolTable,
} from './shared.ts';
import { suggestTagsForReview } from './suggestions.ts';
import { loadOpenFacetIds, setOpenFacetValue, valueOfTag } from './vocabulary.ts';

const reviewIdsOf = (items: ReviewItem[]) => items.map((item) => item.id);

/** The items of `ids` that nobody has settled yet. */
function unsettledReviews(db: Db, ids: number[]): ReviewItem[] {
  const isUnsettled = (item: ReviewItem) =>
    db.reviewsForFile(item.file_id).some((other) => other.id === item.id);
  return db.reviewsByIds(ids).filter(isUnsettled);
}

/** Settles items as accepted: their values join the vocabulary, and their tags join a plan. */
async function acceptIntoPlan(ctx: Context, items: ReviewItem[]): Promise<Plan> {
  const { db } = ctx;
  const openFacets = await loadOpenFacetIds(ctx.config);
  return db.transaction(() => {
    for (const item of items) {
      const facetId = tagFacet(item.tag);
      if (openFacets.includes(facetId)) db.setVocabulary(facetId, valueOfTag(item.tag), 'active');
    }
    db.resolveReviews(reviewIdsOf(items), 'accepted');
    return proposeReviews(db, items, planSource(ctx));
  });
}

/** Accepts or rejects the unsettled items of `ids`. Only accepting builds a plan. */
async function settleReviews(ctx: Context, ids: number[], accept: boolean): Promise<Plan | null> {
  const items = unsettledReviews(ctx.db, ids);
  if (items.length === 0) return null;
  if (!accept) {
    ctx.db.resolveReviews(reviewIdsOf(items), 'rejected');
    emitReviews(ctx);
    return null;
  }
  const plan = await acceptIntoPlan(ctx, items);
  emitReviews(ctx);
  return plan;
}

/** The tools on reviews, vocabulary and cleanup. */
export const reviewTools = {
  list_reviews: {
    description: 'Items waiting for a person, by tag and then confidence.',
    input: z.strictObject({ tag: tagInput.optional(), limit: z.int().positive().optional() }),
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
    run: async ({ ids, accept }, ctx) => settleReviews(ctx, ids, accept),
  },

  suggest_tags: {
    description:
      'Asks the chat model for new tags, as review items. Writes no tags, but sends file data to the provider and costs money.',
    input: z.strictObject({ id: fileIdInput }),
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, ctx) => suggestTagsForReview(ctx, id),
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
    run: async (input, { db, config }) => setOpenFacetValue(db, config, input),
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
