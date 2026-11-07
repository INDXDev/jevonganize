/**
 * Favorite tags, and the numbers the Dashboard shows: model usage and the state of the index. All of
 * it is read from or written to the local index only, and nothing here calls a model.
 */
import type { LibraryReport, UsageReport } from '../../tool-map.ts';
import { z } from 'zod';
import { UserError } from '../config.ts';
import type { Db, UsageBucket } from '../db.ts';
import { nothing, tag, type ToolTable } from './shared.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_TAGS = 10;
const HIT_RATE_DAYS = 30;

const time = z.int().nonnegative();

/** Usage in `[since, until)`, both optional. */
function usageReport(
  db: Db,
  { since = 0, until, bucket = 'day' }: { since?: number; until?: number; bucket?: UsageBucket },
): UsageReport {
  const end = until ?? Number.MAX_SAFE_INTEGER;
  if (end <= since) throw new UserError('until must come after since');
  return db.usageReport({ since, until: end }, bucket);
}

/** What the index holds: libraries, kinds of file, tags in use, reviews, plans and the cache. */
function libraryReport(db: Db): LibraryReport {
  return {
    libraries: db.libraryCounts(),
    kinds: db.kindCounts(),
    top_tags: db.tagCounts().slice(0, TOP_TAGS),
    reviews_open: db.stats().reviews,
    plans: db.planCounts(),
    cache: {
      answers: db.answerCount(),
      hit_rate_30d: db.cacheHitRate(Date.now() - HIT_RATE_DAYS * DAY_MS),
    },
  };
}

/** The tools on favorites and reports. */
export const reportTools = {
  list_favorite_tags: {
    description:
      'Tags a person starred, in their order, with the files carrying each now. A tag stays listed at 0.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { db }) => db.listFavoriteTags(),
  },

  set_favorite_tag: {
    description:
      'Stars or unstars a tag, or moves a starred tag to a position. Stored state only, never a tag.',
    input: z.strictObject({
      tag,
      favorite: z.boolean(),
      position: z.int().nonnegative().optional(),
    }),
    writes: true,
    agent: false,
    run: async (input, { db }) => db.setFavoriteTag(input),
  },

  usage_report: {
    description:
      'Model calls recorded on this machine: tokens both ways and estimated cost, in total and by day, week or month, feature and model.',
    input: z.strictObject({
      since: time.optional(),
      until: time.optional(),
      bucket: z.enum(['day', 'week', 'month']).optional(),
    }),
    writes: false,
    agent: true,
    run: async (input, { db }) => usageReport(db, input),
  },

  library_report: {
    description:
      'The state of the index: files per library by state, kinds of file, the most used tags, open reviews, plans and the answer cache.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { db }) => libraryReport(db),
  },
} satisfies Partial<ToolTable>;
