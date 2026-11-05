/** Commands over files: scan, organize, plans, search, tags, review. Thin: tools do the work. */
import { stat } from 'node:fs/promises';
import { sep } from 'node:path';
import type { Command } from 'commander';
import { ifExists, UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import { callTool, type Context } from '../core/tools.ts';
import type { FileQuery, Plan, ReviewItem } from '../types.ts';
import { askEnvConsent } from './settings.ts';
import {
  applyAndReport,
  command,
  commaList,
  costLine,
  count,
  fileArg,
  follow,
  indexedPath,
  type JsonFlag,
  note,
  out,
  outJson,
  printPlan,
  queryFlags,
  type QueryFlags,
  reportErrors,
  shown,
  someTags,
  sum,
  toQuery,
  withContext as withFlags,
} from './shared.ts';

const DEFAULT_SEARCH_LIMIT = 50;
const TOP_TAGS = 10;
const KIB = 1024;

function size(bytes: number): string {
  if (bytes < KIB) return `${bytes} B`;
  if (bytes < KIB ** 2) return `${Math.round(bytes / KIB)} KB`;
  return `${(bytes / KIB ** 2).toFixed(1)} MB`;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const nothingWritten = (id: string) => out(`Nothing was written. Run: jevonganize apply ${id}`);

async function runScan(path: string | undefined, flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    const root = path === undefined ? undefined : indexedPath(path);
    if (root !== undefined) {
      const known = (await callTool('list_libraries', {}, ctx)).some((lib) => lib.path === root);
      if (!known) await callTool('add_library', { path: root }, ctx);
    }
    const final = await follow(ctx, await callTool('scan', { path: root }, ctx));
    if (flags.json || !final.scan) return;
    const { files, added, changed, restores, skipped } = final.scan;
    const parts = [`${count(files)} files`, `${count(added)} new`, `${count(changed)} changed`];
    if (restores > 0) parts.push(`${count(restores)} restore items`);
    out(`Scanned ${root === undefined ? 'all libraries' : shown(root)}: ${parts.join(', ')}.`);
    if (skipped > 0) out(`Skipped ${count(skipped)} by exclusion rules.`);
  });
}

async function requireLibraryPath(path: string, ctx: Context): Promise<void> {
  const libraries = await callTool('list_libraries', {}, ctx);
  const inside = libraries.some((lib) => path === lib.path || path.startsWith(lib.path + sep));
  if (!inside) throw new UserError(`${path} is not in a library. Run: jevonganize scan ${path}`);
}

interface OrganizeFlags extends JsonFlag {
  dryRun?: boolean;
  apply?: boolean;
  facets?: string[];
  limit?: number;
}

function printOrganized(plan: Plan, reviews: number): void {
  printPlan(plan);
  const top = Object.entries(plan.summary.added)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, TOP_TAGS);
  for (const [tag, total] of top) out(`  ${sanitizeLine(tag).padEnd(24)}${count(total)}`);
  if (reviews > 0) out(`${count(reviews)} items need review: jevonganize review`);
}

async function runOrganize(path: string, flags: OrganizeFlags) {
  if (flags.dryRun && flags.apply) throw new UserError('--dry-run and --apply cannot be combined');
  await withFlags(flags, async (ctx) => {
    const folder = indexedPath(path);
    await requireLibraryPath(folder, ctx);
    const query: FileQuery = { folder, ...(flags.limit !== undefined && { limit: flags.limit }) };
    const input = { query, ...(flags.facets && { facets: flags.facets }) };
    const estimate = await callTool('estimate', input, ctx);
    if (flags.dryRun) {
      if (flags.json) return outJson(estimate);
      const { files, cached, facets } = estimate;
      out(`${count(files)} files, ${count(cached)} cached, ${count(facets)} facets`);
      out(costLine(estimate));
      return out('Nothing was sent.');
    }
    note(costLine(estimate));
    await askEnvConsent(ctx.config.provider.name);
    const final = await follow(ctx, await callTool('organize', input, ctx));
    if (final.status === 'cancelled' || !final.plan_id) return undefined;
    if (final.total > 0 && final.failed === final.total) {
      throw new UserError('Every file failed. See the warnings above');
    }
    const plan = await callTool('get_plan', { id: final.plan_id }, ctx);
    if (!flags.json) {
      printOrganized(plan, (await callTool('status', {}, ctx)).reviews);
      if (!flags.apply) nothingWritten(plan.id);
    }
    return flags.apply ? applyAndReport(ctx, plan.id, flags.json) : undefined;
  });
}

function printPlanRow(plan: Plan): void {
  const { files, added, removed } = plan.summary;
  const change = `+${count(sum(added))} -${count(sum(removed))}`;
  const cells = [
    plan.id,
    plan.source.padEnd(9),
    `${count(files)} files`.padEnd(11),
    change.padEnd(10),
  ];
  out(`${cells.join(' ')} ${sanitizeLine(plan.title)}`);
}

async function runPlans(id: string | undefined, flags: JsonFlag & { status?: Plan['status'] }) {
  await withFlags(flags, async (ctx) => {
    if (id !== undefined) {
      const plan = await callTool('get_plan', { id }, ctx);
      if (flags.json) return outJson(plan);
      printPlan(plan);
      return out(`Status: ${plan.status}`);
    }
    const plans = await callTool('list_plans', { status: flags.status }, ctx);
    if (flags.json) return outJson(plans);
    return plans.forEach(printPlanRow);
  });
}

async function runUndo(id: string, flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    const final = await follow(ctx, await callTool('undo_plan', { id }, ctx));
    reportErrors(await callTool('get_plan', { id }, ctx));
    if (!flags.json && final.status === 'done') out(`Undid ${id}: ${count(final.total)} files.`);
  });
}

/** The files `tags add` and `tags remove` touch: one file, or a folder narrowed by flags. */
async function changeScope(path: string, flags: QueryFlags, ctx: Context) {
  const target = indexedPath(path);
  if ((await ifExists(stat(target)))?.isFile()) {
    return { file_ids: [(await fileArg(target, ctx)).id] };
  }
  return { query: { ...toQuery(flags), folder: target } };
}

interface TagFlags extends JsonFlag, QueryFlags {
  apply?: boolean;
}

async function finishPlan(plan: Plan, flags: TagFlags, ctx: Context) {
  if (flags.json) outJson(plan);
  else printPlan(plan);
  if (flags.apply) await applyAndReport(ctx, plan.id, flags.json);
  else if (!flags.json) nothingWritten(plan.id);
}

const runTagChange =
  (change: 'add' | 'remove') => async (path: string, tags: string[], flags: TagFlags) => {
    await withFlags(flags, async (ctx) => {
      const scope = await changeScope(path, flags, ctx);
      const title = `${change} ${tags.join(', ')}`;
      const plan = await callTool('propose_changes', { ...scope, [change]: tags, title }, ctx);
      await finishPlan(plan, flags, ctx);
    });
  };

async function runSearch(text: string | undefined, flags: JsonFlag & QueryFlags) {
  await withFlags(flags, async (ctx) => {
    const query = {
      limit: DEFAULT_SEARCH_LIMIT,
      ...toQuery(flags),
      ...(text !== undefined && { text }),
    };
    const result = await callTool('search_files', query, ctx);
    if (flags.json) return outJson(result);
    for (const file of result.files) {
      out(`${shown(file.path)}  ${size(file.size)}  ${day(file.mtime_ms)}  ${someTags(file.tags)}`);
    }
    return out(`${count(result.files.length)} of ${count(result.total)} files`);
  });
}

async function runShow(arg: string, flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    const file = await fileArg(arg, ctx);
    if (flags.json) return outJson(file);
    out(`${shown(file.path)}  (id ${file.id})`);
    const mime = sanitizeLine(file.mime ?? 'unknown type');
    out(`${mime}, ${size(file.size)}, modified ${day(file.mtime_ms)}, ${file.status}`);
    if (file.tags.length > 0) out(`Tags     ${file.tags.map(sanitizeLine).join('  ')}`);
    const answers = file.answers.filter((answer) => answer.value !== null);
    if (answers.length > 0) {
      const line = answers.map(
        (a) => `${a.facet} ${a.value} ${a.confidence === null ? 'n/a' : a.confidence.toFixed(2)}`,
      );
      out(`Answers  ${sanitizeLine(line.join(' / '))}`);
    }
    for (const item of file.reviews) {
      const confidence = item.confidence === null ? 'n/a' : item.confidence.toFixed(2);
      out(`Review   ${sanitizeLine(item.tag)} ${confidence}`);
    }
    return undefined;
  });
}

async function runSimilar(arg: string, flags: JsonFlag & { limit?: number }) {
  await withFlags(flags, async (ctx) => {
    const { id } = await fileArg(arg, ctx);
    const files = await callTool('similar_files', { id, limit: flags.limit ?? 20 }, ctx);
    if (flags.json) return outJson(files);
    for (const file of files) {
      out(
        `${file.score.toFixed(2)}  ${shown(file.path)}  ${file.shared.map(sanitizeLine).join(' ')}`,
      );
    }
    return undefined;
  });
}

interface ReviewFlags extends JsonFlag {
  tag?: string;
  limit?: number;
  accept?: string;
  reject?: string;
}

async function reviewIds(value: string, tag: string | undefined, ctx: Context): Promise<number[]> {
  if (value !== 'all') return commaList(value).map(Number);
  if (tag === undefined) throw new UserError('"all" needs --tag');
  return (await callTool('list_reviews', { tag }, ctx)).map((item) => item.id);
}

async function printReviews(items: ReviewItem[], ctx: Context): Promise<void> {
  const groups = Map.groupBy(items, (item) => `${item.kind}\n${item.tag}`);
  for (const [key, group] of groups) {
    const [kind = '', tag = ''] = key.split('\n');
    out(`${kind === 'restore' ? 'restore: ' : ''}${sanitizeLine(tag)} (${count(group.length)})`);
    for (const item of group) {
      const { path } = await callTool('get_file', { id: item.file_id }, ctx);
      const confidence = item.confidence === null ? 'n/a ' : item.confidence.toFixed(2);
      const reason = kind === 'restore' ? `  ${sanitizeLine(item.reason)}` : '';
      out(`  ${item.id}  ${confidence}  ${shown(path)}${reason}`);
    }
  }
}

async function runReview(flags: ReviewFlags) {
  if (flags.accept !== undefined && flags.reject !== undefined) {
    throw new UserError('--accept and --reject cannot be combined');
  }
  await withFlags(flags, async (ctx) => {
    const chosen = flags.accept ?? flags.reject;
    if (chosen === undefined) {
      const items = await callTool('list_reviews', { tag: flags.tag, limit: flags.limit }, ctx);
      return flags.json ? outJson(items) : printReviews(items, ctx);
    }
    const ids = await reviewIds(chosen, flags.tag, ctx);
    const accept = flags.accept !== undefined;
    const plan = await callTool('resolve_reviews', { ids, accept }, ctx);
    if (flags.json) outJson(plan);
    if (plan) {
      const final = await follow(ctx, await callTool('apply_plan', { id: plan.id }, ctx));
      reportErrors(await callTool('get_plan', { id: plan.id }, ctx));
      if (final.status !== 'done') return undefined;
    }
    if (!flags.json) out(`${accept ? 'Accepted' : 'Rejected'} ${count(ids.length)} items.`);
    return undefined;
  });
}

async function runSuggest(arg: string, flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    await askEnvConsent(ctx.config.chat.name);
    const { id } = await fileArg(arg, ctx);
    const items = await callTool('suggest_tags', { id }, ctx);
    if (flags.json) return outJson(items);
    out(`Added ${count(items.length)} review items:`);
    for (const item of items) out(`  ${item.id}  ${sanitizeLine(item.tag)}`);
    return undefined;
  });
}

async function runCleanup(flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    const report = await callTool('cleanup_report', {}, ctx);
    if (flags.json) return outJson(report);
    const { files } = await callTool('status', {}, ctx);
    out('Near-duplicates');
    for (const { tags, files: total } of report.near_duplicates) {
      out(`  ${tags.map(sanitizeLine).join(' / ')}   ${count(total)}`);
    }
    out('One file');
    for (const { tag } of report.single_use) out(`  ${sanitizeLine(tag)}`);
    out('Over-broad');
    for (const row of report.over_broad) {
      out(`  ${sanitizeLine(row.tag)}   on ${Math.round((row.count / files) * 100)}% of files`);
    }
    return undefined;
  });
}

async function runTagsList(flags: JsonFlag & { folder?: string; facet?: string }) {
  await withFlags(flags, async (ctx) => {
    const folder = flags.folder === undefined ? undefined : indexedPath(flags.folder);
    const tags = await callTool('list_tags', { folder, facet: flags.facet }, ctx);
    if (flags.json) return outJson(tags);
    for (const { tag, count: total } of tags) out(`${sanitizeLine(tag).padEnd(24)}${count(total)}`);
    return undefined;
  });
}

/** Adds the commands of this file. */
export function addFileCommands(program: Command): void {
  command(program, 'scan [path]', 'Update the index. Free and local').action(runScan);

  command(program, 'organize <path>', 'Classify files and produce a plan')
    .option('--dry-run', 'Print the estimate and stop')
    .option('--apply', 'Apply the plan when it is ready')
    .option('--facets <ids>', 'Comma-separated facets or packs for this run', commaList)
    .option('--limit <n>', 'Organize at most this many files', Number)
    .action(runOrganize);

  command(program, 'plans [id]', 'List plans, or show one')
    .option('--status <status>', 'proposed, applied, undone or failed')
    .action(runPlans);

  command(program, 'apply <id>', 'Apply a stored plan').action(
    async (id: string, flags: JsonFlag) =>
      withFlags(flags, (ctx) => applyAndReport(ctx, id, flags.json)),
  );

  command(program, 'undo <id>', 'Reverse an applied plan').action(runUndo);

  const tags = program.command('tags').description('List and change tags');
  command(tags, 'list', 'Tags with counts')
    .option('--folder <path>', 'Only this folder')
    .option('--facet <id>', 'Only this facet')
    .action(runTagsList);
  for (const change of ['add', 'remove'] as const) {
    queryFlags(command(tags, `${change} <path> <tag...>`, `Plan to ${change} tags`))
      .option('--apply', 'Apply the plan at once')
      .action(runTagChange(change));
  }
  command(tags, 'rename <from> <to>', 'Plan to rename a tag on every file that has it')
    .option('--apply', 'Apply the plan at once')
    .action(async (from: string, to: string, flags: TagFlags) =>
      withFlags(flags, async (ctx) =>
        finishPlan(await callTool('rename_tag', { from, to }, ctx), flags, ctx),
      ),
    );

  queryFlags(command(program, 'search [text]', 'Search by text and file name')).action(runSearch);
  command(program, 'show <file>', 'Show one file').action(runShow);
  command(program, 'similar <file>', 'List similar files')
    .option('--limit <n>', 'Files to list', Number)
    .action(runSimilar);
  command(program, 'review', 'List items waiting for a person, or resolve them')
    .option('--tag <tag>', 'Only this tag')
    .option('--limit <n>', 'Items to list', Number)
    .option('--accept <ids>', 'Accept comma-separated ids, or all')
    .option('--reject <ids>', 'Reject comma-separated ids, or all')
    .action(runReview);
  command(program, 'suggest <file>', 'Ask the chat model for candidate tags').action(runSuggest);
  command(program, 'cleanup', 'Report near-duplicate, one-file and over-broad tags').action(
    runCleanup,
  );
}
