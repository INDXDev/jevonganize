/** `organize <path>`: estimate the cost, ask the model about each file, and apply the plan. */
import { t } from './i18n/index.ts';
import { indexedPath, UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import type { Estimate, FileQuery, Plan } from '../types.ts';
import { nothingWritten } from './plans.ts';
import { askEnvConsent } from './prompts.ts';
import {
  applyAndReport,
  callTool,
  costLine,
  count,
  failIfEveryFileFailed,
  follow,
  isInLibrary,
  type JsonFlag,
  note,
  out,
  outJson,
  printPlan,
  withContext,
} from './shared.ts';

/** How many of a plan's added tags the report lists. */
const TOP_TAGS = 10;

/** The flags of `organize`. */
export interface OrganizeFlags extends JsonFlag {
  dryRun?: boolean;
  apply?: boolean;
  facets?: string[];
  limit?: number;
}

/** The input both `estimate` and `organize` take. */
interface OrganizeInput {
  query: FileQuery;
  facets?: string[];
}

async function requireInLibrary(path: string, ctx: Context): Promise<void> {
  if (await isInLibrary(path, ctx)) return;
  throw new UserError(t('{path} is not in a library. Run: jevonganize scan {path}', { path }));
}

function toOrganizeInput(folder: string, flags: OrganizeFlags): OrganizeInput {
  const query: FileQuery = { folder, ...(flags.limit !== undefined && { limit: flags.limit }) };
  return { query, ...(flags.facets && { facets: flags.facets }) };
}

function printEstimate(estimate: Estimate): void {
  const { files, cached, facets } = estimate;
  out(
    t('{files} files, {cached} cached, {facets} facets', {
      files: count(files),
      cached: count(cached),
      facets: count(facets),
    }),
  );
  out(costLine(estimate));
  out(t('Nothing was sent.'));
}

/** Runs the organize job and returns the id of its plan, or nothing when it was cancelled. */
async function runOrganizeJob(input: OrganizeInput, ctx: Context): Promise<string | undefined> {
  const final = await follow(ctx, await callTool('organize', input, ctx));
  if (final.status === 'cancelled' || !final.plan_id) return undefined;
  failIfEveryFileFailed(final);
  return final.plan_id;
}

/** The plan, its most added tags, and how many items wait for review. */
function printPlanReport(plan: Plan, reviews: number): void {
  printPlan(plan);
  const mostAdded = Object.entries(plan.summary.added)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, TOP_TAGS);
  for (const [tag, files] of mostAdded) out(`  ${sanitizeLine(tag).padEnd(24)}${count(files)}`);
  if (reviews > 0)
    out(t('{count} items need review: jevonganize review', { count: count(reviews) }));
}

/** Sends the files to the model, reports the plan, and applies it unless `--no-apply`. */
async function organizeAndApply(
  input: OrganizeInput,
  estimate: Estimate,
  flags: OrganizeFlags,
  ctx: Context,
): Promise<void> {
  note(costLine(estimate));
  await askEnvConsent(ctx.config.provider.name);
  const planId = await runOrganizeJob(input, ctx);
  if (planId === undefined) return;
  const plan = await callTool('get_plan', { id: planId }, ctx);
  const shouldApply = flags.apply ?? true;
  if (!flags.json) {
    const { reviews } = await callTool('status', {}, ctx);
    printPlanReport(plan, reviews);
    if (!shouldApply) nothingWritten(plan.id);
  }
  if (shouldApply) await applyAndReport(ctx, plan.id, flags.json);
}

/** `organize <path>`. With `--dry-run` it prints the estimate and sends nothing. */
export async function runOrganize(path: string, flags: OrganizeFlags): Promise<void> {
  if (flags.dryRun && flags.apply)
    throw new UserError(t('--dry-run and --apply cannot be combined'));
  await withContext(flags, async (ctx) => {
    const folder = indexedPath(path);
    await requireInLibrary(folder, ctx);
    const input = toOrganizeInput(folder, flags);
    const estimate = await callTool('estimate', input, ctx);
    if (!flags.dryRun) return organizeAndApply(input, estimate, flags, ctx);
    return flags.json ? outJson(estimate) : printEstimate(estimate);
  });
}
