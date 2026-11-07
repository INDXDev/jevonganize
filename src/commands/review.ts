/** `review` and `suggest`: the items that wait for a person to accept or reject them. */
import { t } from './i18n/index.ts';
import { UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import type { ReviewItem } from '../types.ts';
import { askEnvConsent } from './prompts.ts';
import {
  callTool,
  commaList,
  count,
  fileArg,
  follow,
  type JsonFlag,
  out,
  outJson,
  reportErrors,
  shown,
  withContext,
} from './shared.ts';

/** The flags of `review`. */
export interface ReviewFlags extends JsonFlag {
  tag?: string;
  limit?: number;
  accept?: string;
  reject?: string;
}

/** Prints one group of review items that share a kind and a tag. */
async function printReviewGroup(group: ReviewItem[], ctx: Context): Promise<void> {
  const [first] = group;
  if (!first) return;
  const isRestore = first.kind === 'restore';
  out(`${isRestore ? t('restore: ') : ''}${sanitizeLine(first.tag)} (${count(group.length)})`);
  for (const item of group) {
    const { path } = await callTool('get_file', { id: item.file_id }, ctx);
    // The trailing space keeps 'n/a' as wide as a two-decimal number.
    const confidence = item.confidence === null ? 'n/a ' : item.confidence.toFixed(2);
    const reason = isRestore ? `  ${sanitizeLine(item.reason)}` : '';
    out(`  ${item.id}  ${confidence}  ${shown(path)}${reason}`);
  }
}

async function listReviews(flags: ReviewFlags, ctx: Context): Promise<void> {
  const items = await callTool('list_reviews', { tag: flags.tag, limit: flags.limit }, ctx);
  if (flags.json) return outJson(items);
  const groups = Map.groupBy(items, (item) => `${item.kind}\n${item.tag}`);
  for (const group of groups.values()) await printReviewGroup(group, ctx);
  return undefined;
}

/** The ids an `--accept` or `--reject` value names. `all` means every item with `--tag`. */
async function reviewIds(value: string, tag: string | undefined, ctx: Context): Promise<number[]> {
  if (value !== 'all') return commaList(value).map(Number);
  if (tag === undefined) throw new UserError(t('"all" needs --tag'));
  return (await callTool('list_reviews', { tag }, ctx)).map((item) => item.id);
}

async function resolveReviews(chosen: string, flags: ReviewFlags, ctx: Context): Promise<void> {
  const ids = await reviewIds(chosen, flags.tag, ctx);
  const accept = flags.accept !== undefined;
  const plan = await callTool('resolve_reviews', { ids, accept }, ctx);
  if (flags.json) outJson(plan);
  // A rejection, or ids that match no item, come back with no plan to apply.
  const isApplied = plan ? await applyResolution(plan.id, ctx) : true;
  if (!isApplied || flags.json) return;
  const resolved = { count: count(ids.length) };
  out(t(accept ? 'Accepted {count} items.' : 'Rejected {count} items.', resolved));
}

/** Applies the plan that accepted items make. True when it ran to the end. */
async function applyResolution(planId: string, ctx: Context): Promise<boolean> {
  const final = await follow(ctx, await callTool('apply_plan', { id: planId }, ctx));
  reportErrors(await callTool('get_plan', { id: planId }, ctx));
  return final.status === 'done';
}

/** `review`: lists the items, or accepts or rejects the ones named. */
export async function runReview(flags: ReviewFlags): Promise<void> {
  if (flags.accept !== undefined && flags.reject !== undefined) {
    throw new UserError(t('--accept and --reject cannot be combined'));
  }
  await withContext(flags, async (ctx) => {
    const chosen = flags.accept ?? flags.reject;
    if (chosen === undefined) await listReviews(flags, ctx);
    else await resolveReviews(chosen, flags, ctx);
  });
}

/** `suggest <file>`: asks the chat model for candidate tags, which become review items. */
export async function runSuggest(arg: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    await askEnvConsent(ctx.config.chat.name);
    const { id } = await fileArg(arg, ctx);
    const items = await callTool('suggest_tags', { id }, ctx);
    if (flags.json) return outJson(items);
    out(t('Added {count} review items:', { count: count(items.length) }));
    for (const item of items) out(`  ${item.id}  ${sanitizeLine(item.tag)}`);
    return undefined;
  });
}
