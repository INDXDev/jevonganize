/**
 * Organizing files, and the plans that come of it. Each row of `planTools` is one operation. Slow
 * ones return a job at once and finish in the background, and only `apply_plan` writes tags.
 */
import { z } from 'zod';
import type { Facet, Plan, TagOp } from '../../types.ts';
import { UserError } from '../config.ts';
import type { Db } from '../db.ts';
import { loadFacets } from '../facets.ts';
import { estimateRun } from '../estimate.ts';
import { nameReader } from '../names.ts';
import { facetsForRun, modelsForRun } from '../organize-setup.ts';
import { proposeRenameWithChildren } from '../tag-move.ts';
import { organizeFiles } from '../organize.ts';
import {
  applyPlan,
  claimPlan,
  type JobRun,
  proposeChanges,
  proposeRename,
  recoverPlans,
  undoPlan,
} from '../plans.ts';
import { jobs, running, startJob } from './jobs.ts';
import {
  type Context,
  emitReviews,
  fileId,
  fileQuery,
  planSource,
  refreshTags,
  tag,
  type ToolTable,
} from './shared.ts';

const planIdInput = z.strictObject({ id: z.string().min(1) });
const organizeInput = z.strictObject({ query: fileQuery, facets: z.array(z.string()).optional() });

function requirePlan(db: Db, id: string): Plan {
  const plan = db.getPlan(id);
  if (!plan) throw new UserError(`There is no plan ${id}`);
  return plan;
}

function refuseIfPlanBusy(id: string): void {
  if (running().some(({ job }) => job.plan_id === id && job.kind !== 'organize')) {
    throw new UserError(`Plan ${id} is already being worked on`);
  }
}

function refuseIfOrganizing(): void {
  if (running().some(({ job }) => job.kind === 'organize')) {
    throw new UserError('An organize job is already running');
  }
}

/** What applying or undoing a plan needs to start. */
interface PlanJob {
  kind: 'apply' | 'undo';
  plan: Plan;
  facets: Facet[];
}

/** Starts the job that applies or undoes a plan. `work` returns the outcome and the ops it touched. */
function startPlanJob(
  ctx: Context,
  { kind, plan, facets }: PlanJob,
  work: (run: JobRun) => Promise<{ outcome: Plan; touched: TagOp[] }>,
) {
  const start = { plan_id: plan.id, total: plan.ops.length };
  const runAndReport = async (run: JobRun) => {
    const { outcome, touched } = await work(run);
    refreshTags(ctx.db, facets);
    run.update({ failed: Object.keys(outcome.errors ?? {}).length });
    ctx.emit({ type: 'files', ids: touched.map((op) => op.file_id) });
  };
  return startJob(kind, ctx, runAndReport, start);
}

/** The tools that organize files and work with plans. */
export const planTools = {
  estimate: {
    description: 'What organizing these files would cost. Sends nothing.',
    input: organizeInput,
    writes: false,
    agent: true,
    run: async (input, { db, config }) => estimateRun(db, config, input),
  },

  organize: {
    description:
      'Classifies files with the model and produces a plan. Writes no tags, but sends file data to the provider and costs money. Starts a job.',
    input: organizeInput,
    writes: true,
    agent: true,
    approval: true,
    run: async (input, ctx) => {
      const { db, config } = ctx;
      refuseIfOrganizing();
      const facets = await facetsForRun(db, config, input.facets);
      const ner = await nameReader(config);
      const models = await modelsForRun(config, facets); // refuses here, before anything is sent
      return startJob('organize', ctx, async (run) => {
        await organizeFiles({ db, config, facets, models, ner }, input, run);
        emitReviews(ctx);
      });
    },
  },

  cancel_job: {
    description: 'Stops a running job.',
    input: z.strictObject({ id: z.string().min(1) }),
    writes: true,
    agent: false,
    run: async ({ id }) => {
      const entry = jobs.get(id);
      if (!entry) throw new UserError(`There is no job ${id}`);
      entry.controller.abort();
    },
  },

  propose_changes: {
    description: 'Stores a plan to add or remove tags. Changes no tag until a person applies it.',
    input: z.strictObject({
      query: fileQuery.optional(),
      file_ids: z.array(fileId).optional(),
      add: z.array(tag).optional(),
      remove: z.array(tag).optional(),
      title: z.string().min(1),
    }),
    writes: true,
    agent: true,
    run: async (input, ctx) => proposeChanges(ctx.db, input, planSource(ctx)),
  },

  rename_tag: {
    description:
      'Stores a plan to rename a tag on every file that has it. With children, every tag under it follows.',
    input: z.strictObject({ from: tag, to: tag, children: z.boolean().optional() }),
    writes: true,
    agent: true,
    run: async ({ from, to, children }, ctx) => {
      if (!children) return proposeRename(ctx.db, from, to, planSource(ctx));
      const facets = await loadFacets(ctx.config);
      return proposeRenameWithChildren(ctx.db, facets, { from, to }, planSource(ctx));
    },
  },

  apply_plan: {
    description: 'Applies a stored plan by id. Starts a job.',
    input: planIdInput,
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, ctx) => {
      const facets = await loadFacets(ctx.config);
      const plan = claimPlan(ctx.db, id); // no `await` from here to the job, so no gap to race in
      return startPlanJob(ctx, { kind: 'apply', plan, facets }, async (run) => {
        const rules = { facets, maxTags: ctx.config.max_tags };
        const applied = await applyPlan(ctx.db, plan, rules, run);
        return { outcome: applied, touched: applied.ops };
      });
    },
  },

  undo_plan: {
    description: 'Reverses an applied plan by id. Starts a job.',
    input: planIdInput,
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, ctx) => {
      const plan = requirePlan(ctx.db, id);
      if (plan.status !== 'applied') throw new UserError(`Plan ${id} is ${plan.status}`);
      refuseIfPlanBusy(id);
      const facets = await loadFacets(ctx.config);
      return startPlanJob(ctx, { kind: 'undo', plan, facets }, async (run) => ({
        outcome: await undoPlan(ctx.db, plan, run),
        touched: plan.ops,
      }));
    },
  },

  get_plan: {
    description: 'One plan, with its ops.',
    input: planIdInput,
    writes: false,
    agent: true,
    run: async ({ id }, { db }) => requirePlan(db, id),
  },

  discard_plan: {
    description: 'Deletes a plan that was never applied.',
    input: planIdInput,
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, { db }) => {
      const { status } = requirePlan(db, id);
      if (status !== 'proposed') throw new UserError(`Plan ${id} is ${status}, so it stays`);
      if (db.planOps(id).length > 0) {
        throw new UserError(`Plan ${id} ran part of the way. Apply it, and then it can be undone`);
      }
      db.deletePlan(id);
    },
  },

  list_plans: {
    description: 'Plans, newest first, without their ops.',
    input: z.strictObject({
      status: z.enum(['proposed', 'applying', 'applied', 'undone', 'failed']).optional(),
    }),
    writes: false,
    agent: true,
    run: async ({ status }, { db }) => {
      recoverPlans(db);
      return db.listPlans(status);
    },
  },
} satisfies Partial<ToolTable>;
