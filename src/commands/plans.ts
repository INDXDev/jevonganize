/** `plans`, `apply` and `undo`, and how a command ends on a plan it proposed. */
import { t, statusLabel } from './i18n/index.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import type { Plan } from '../types.ts';
import {
  applyAndReport,
  callTool,
  count,
  follow,
  type JsonFlag,
  out,
  outJson,
  printPlan,
  reportErrors,
  sum,
  withContext,
} from './shared.ts';

/** Says that a proposed plan wrote nothing, and how to apply it. */
export const nothingWritten = (id: string) =>
  out(t('Nothing was written. Run: jevonganize apply {id}', { id }));

/** Prints a plan someone proposed, then applies it if `--apply` was given. */
export async function finishPlan(
  plan: Plan,
  flags: JsonFlag & { apply?: boolean },
  ctx: Context,
): Promise<void> {
  if (flags.json) outJson(plan);
  else printPlan(plan);
  if (flags.apply) await applyAndReport(ctx, plan.id, flags.json);
  else if (!flags.json) nothingWritten(plan.id);
}

function printPlanRow(plan: Plan): void {
  const { files, added, removed } = plan.summary;
  const tagChange = `+${count(sum(added))} -${count(sum(removed))}`;
  const cells = [
    plan.id,
    plan.source.padEnd(9),
    t('{count} files', { count: count(files) }).padEnd(11),
    tagChange.padEnd(10),
  ];
  out(`${cells.join(' ')} ${sanitizeLine(plan.title)}`);
}

/** `plans [id]`: one plan with its status, or a row per plan. */
export async function runPlans(
  id: string | undefined,
  flags: JsonFlag & { status?: Plan['status'] },
): Promise<void> {
  await withContext(flags, async (ctx) => {
    if (id !== undefined) {
      const plan = await callTool('get_plan', { id }, ctx);
      if (flags.json) return outJson(plan);
      printPlan(plan);
      return out(t('Status: {status}', { status: statusLabel(plan.status) }));
    }
    const plans = await callTool('list_plans', { status: flags.status }, ctx);
    if (flags.json) return outJson(plans);
    return plans.forEach(printPlanRow);
  });
}

/** `apply <id>`. */
export async function runApply(id: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, (ctx) => applyAndReport(ctx, id, flags.json));
}

/** `undo <id>`. */
export async function runUndo(id: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const final = await follow(ctx, await callTool('undo_plan', { id }, ctx));
    reportErrors(await callTool('get_plan', { id }, ctx));
    if (!flags.json && final.status === 'done')
      out(t('Undid {id}: {count} files.', { id, count: count(final.total) }));
  });
}
