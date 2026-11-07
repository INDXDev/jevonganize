/**
 * Refreshing a tag: the files that lack it but look like those that have it. Finding them is free,
 * and checking them asks the decision model. Hits become review items, never tags.
 */
import { z } from 'zod';
import { resolveModel } from '../../ai/providers.ts';
import { UserError } from '../config.ts';
import {
  findCandidates,
  REFRESH_LIMIT,
  REFRESH_MAX,
  refreshFiles,
  refreshQuestion,
} from '../tag-refresh.ts';
import { running, startJob } from './jobs.ts';
import { emitReviews, fileId, tag, type ToolTable } from './shared.ts';

const limit = z.int().positive().max(REFRESH_MAX).optional();

function refuseIfRefreshing(name: string): void {
  if (running().some(({ job }) => job.kind === 'refresh' && job.tag === name)) {
    throw new UserError(`A refresh of ${name} is already running`);
  }
}

/** The tools that spread a tag to files that look like its files. */
export const refreshTools = {
  refresh_candidates: {
    description:
      'Files that lack a tag but look like the files that have it, best first, with why. Calls no model and sends nothing.',
    input: z.strictObject({ tag, limit }),
    writes: false,
    agent: true,
    run: async (input, { db, config }) => findCandidates(db, config, input.tag, input.limit),
  },

  refresh_tag: {
    description:
      'Asks the decision model whether each candidate of refresh_candidates fits the tag, and queues the yeses for review. Writes no tags, but sends file data to the provider and costs money. Starts a job.',
    input: z.strictObject({ tag, limit, file_ids: z.array(fileId).max(REFRESH_MAX).optional() }),
    writes: true,
    agent: true,
    approval: true,
    run: async (input, ctx) => {
      const { db, config } = ctx;
      refuseIfRefreshing(input.tag);
      const question = await refreshQuestion(config, input.tag);
      const model = await resolveModel(config, question.facet.profile); // refuses before sending
      const pool = input.file_ids ? REFRESH_MAX : (input.limit ?? REFRESH_LIMIT);
      const found = await findCandidates(db, config, input.tag, pool);
      const picked = input.file_ids && new Set(input.file_ids);
      const candidates = picked
        ? found.candidates.filter((candidate) => picked.has(candidate.id))
        : found.candidates;
      const setup = { db, config, question, model, candidates };
      return startJob(
        'refresh',
        ctx,
        async (run) => {
          await refreshFiles(setup, run);
          emitReviews(ctx);
        },
        { total: candidates.length, tag: input.tag },
      );
    },
  },
} satisfies Partial<ToolTable>;
