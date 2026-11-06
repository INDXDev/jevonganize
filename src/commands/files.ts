/** Commands over files: scan, organize, plans, search, tags, review. Thin: tools do the work. */
import { t, statusLabel } from './i18n/index.ts';
import { stat } from 'node:fs/promises';
import { sep } from 'node:path';
import type { Command } from 'commander';
import { ifExists, indexedPath, UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import type { FileQuery, Plan, ReviewItem } from '../types.ts';
import { askEnvConsent } from './settings.ts';
import {
  applyAndReport,
  callTool,
  command,
  commaList,
  costLine,
  count,
  fileArg,
  follow,
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

const nothingWritten = (id: string) =>
  out(t('Nothing was written. Run: jevonganize apply {id}', { id }));

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
    const parts = [
      t('{count} files', { count: count(files) }),
      t('{count} new', { count: count(added) }),
      t('{count} changed', { count: count(changed) }),
    ];
    if (restores > 0) parts.push(t('{count} restore items', { count: count(restores) }));
    out(
      t('Scanned {root}: {summary}.', {
        root: root === undefined ? t('all libraries') : shown(root),
        summary: parts.join(', '),
      }),
    );
    if (skipped > 0) out(t('Skipped {count} by exclusion rules.', { count: count(skipped) }));
  });
}

async function requireLibraryPath(path: string, ctx: Context): Promise<void> {
  const libraries = await callTool('list_libraries', {}, ctx);
  const inside = libraries.some((lib) => path === lib.path || path.startsWith(lib.path + sep));
  if (!inside)
    throw new UserError(t('{path} is not in a library. Run: jevonganize scan {path}', { path }));
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
  if (reviews > 0)
    out(t('{count} items need review: jevonganize review', { count: count(reviews) }));
}

async function runOrganize(path: string, flags: OrganizeFlags) {
  if (flags.dryRun && flags.apply)
    throw new UserError(t('--dry-run and --apply cannot be combined'));
  await withFlags(flags, async (ctx) => {
    const folder = indexedPath(path);
    await requireLibraryPath(folder, ctx);
    const query: FileQuery = { folder, ...(flags.limit !== undefined && { limit: flags.limit }) };
    const input = { query, ...(flags.facets && { facets: flags.facets }) };
    const estimate = await callTool('estimate', input, ctx);
    if (flags.dryRun) {
      if (flags.json) return outJson(estimate);
      const { files, cached, facets } = estimate;
      out(
        t('{files} files, {cached} cached, {facets} facets', {
          files: count(files),
          cached: count(cached),
          facets: count(facets),
        }),
      );
      out(costLine(estimate));
      return out(t('Nothing was sent.'));
    }
    note(costLine(estimate));
    await askEnvConsent(ctx.config.provider.name);
    const final = await follow(ctx, await callTool('organize', input, ctx));
    if (final.status === 'cancelled' || !final.plan_id) return undefined;
    if (final.total > 0 && final.failed === final.total) {
      throw new UserError(t('Every file failed. See the warnings above'));
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
    t('{count} files', { count: count(files) }).padEnd(11),
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
      return out(t('Status: {status}', { status: statusLabel(plan.status) }));
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
    if (!flags.json && final.status === 'done')
      out(t('Undid {id}: {count} files.', { id, count: count(final.total) }));
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
    return out(
      t('{shown} of {total} files', {
        shown: count(result.files.length),
        total: count(result.total),
      }),
    );
  });
}

async function runShow(arg: string, flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    const file = await fileArg(arg, ctx);
    if (flags.json) return outJson(file);
    out(`${shown(file.path)}  (id ${file.id})`);
    const mime = sanitizeLine(file.mime ?? t('unknown type'));
    out(
      t('{mime}, {size}, modified {date}, {status}', {
        mime,
        size: size(file.size),
        date: day(file.mtime_ms),
        status: statusLabel(file.status),
      }),
    );
    if (file.tags.length > 0)
      out(t('Tags     {tags}', { tags: file.tags.map(sanitizeLine).join('  ') }));
    const answers = file.answers.filter((answer) => answer.value !== null);
    if (answers.length > 0) {
      const line = answers.map(
        (a) => `${a.facet} ${a.value} ${a.confidence === null ? 'n/a' : a.confidence.toFixed(2)}`,
      );
      out(t('Answers  {answers}', { answers: sanitizeLine(line.join(' / ')) }));
    }
    for (const item of file.reviews) {
      const confidence = item.confidence === null ? 'n/a' : item.confidence.toFixed(2);
      out(t('Review   {tag} {confidence}', { tag: sanitizeLine(item.tag), confidence }));
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
  if (tag === undefined) throw new UserError(t('"all" needs --tag'));
  return (await callTool('list_reviews', { tag }, ctx)).map((item) => item.id);
}

async function printReviews(items: ReviewItem[], ctx: Context): Promise<void> {
  const groups = Map.groupBy(items, (item) => `${item.kind}\n${item.tag}`);
  for (const [key, group] of groups) {
    const [kind = '', tag = ''] = key.split('\n');
    out(`${kind === 'restore' ? t('restore: ') : ''}${sanitizeLine(tag)} (${count(group.length)})`);
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
    throw new UserError(t('--accept and --reject cannot be combined'));
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
    if (!flags.json)
      out(
        t(accept ? 'Accepted {count} items.' : 'Rejected {count} items.', {
          count: count(ids.length),
        }),
      );
    return undefined;
  });
}

async function runSuggest(arg: string, flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    await askEnvConsent(ctx.config.chat.name);
    const { id } = await fileArg(arg, ctx);
    const items = await callTool('suggest_tags', { id }, ctx);
    if (flags.json) return outJson(items);
    out(t('Added {count} review items:', { count: count(items.length) }));
    for (const item of items) out(`  ${item.id}  ${sanitizeLine(item.tag)}`);
    return undefined;
  });
}

async function runCleanup(flags: JsonFlag) {
  await withFlags(flags, async (ctx) => {
    const report = await callTool('cleanup_report', {}, ctx);
    if (flags.json) return outJson(report);
    const { files } = await callTool('status', {}, ctx);
    out(t('Near-duplicates'));
    for (const { tags, files: total } of report.near_duplicates) {
      out(`  ${tags.map(sanitizeLine).join(' / ')}   ${count(total)}`);
    }
    out(t('One file'));
    for (const { tag } of report.single_use) out(`  ${sanitizeLine(tag)}`);
    out(t('Over-broad'));
    for (const row of report.over_broad) {
      out(
        t('  {tag}   on {percent}% of files', {
          tag: sanitizeLine(row.tag),
          percent: Math.round((row.count / files) * 100),
        }),
      );
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
  command(program, 'scan [path]', t('Update the index. Free and local')).action(runScan);

  command(program, 'organize <path>', t('Classify files and produce a plan'))
    .option('--dry-run', t('Print the estimate and stop'))
    .option('--apply', t('Apply the plan when it is ready'))
    .option('--facets <ids>', t('Comma-separated facets or packs for this run'), commaList)
    .option('--limit <n>', t('Organize at most this many files'), Number)
    .action(runOrganize);

  command(program, 'plans [id]', t('List plans, or show one'))
    .option('--status <status>', t('proposed, applied, undone or failed'))
    .action(runPlans);

  command(program, 'apply <id>', t('Apply a stored plan')).action(
    async (id: string, flags: JsonFlag) =>
      withFlags(flags, (ctx) => applyAndReport(ctx, id, flags.json)),
  );

  command(program, 'undo <id>', t('Reverse an applied plan')).action(runUndo);

  const tags = program.command('tags').description(t('List and change tags'));
  command(tags, 'list', t('Tags with counts'))
    .option('--folder <path>', t('Only this folder'))
    .option('--facet <id>', t('Only this facet'))
    .action(runTagsList);
  for (const change of ['add', 'remove'] as const) {
    queryFlags(
      command(
        tags,
        `${change} <path> <tag...>`,
        t(change === 'add' ? 'Plan to add tags' : 'Plan to remove tags'),
      ),
    )
      .option('--apply', t('Apply the plan at once'))
      .action(runTagChange(change));
  }
  command(tags, 'rename <from> <to>', t('Plan to rename a tag on every file that has it'))
    .option('--apply', t('Apply the plan at once'))
    .action(async (from: string, to: string, flags: TagFlags) =>
      withFlags(flags, async (ctx) =>
        finishPlan(await callTool('rename_tag', { from, to }, ctx), flags, ctx),
      ),
    );

  queryFlags(command(program, 'search [text]', t('Search by text and file name'))).action(
    runSearch,
  );
  command(program, 'show <file>', t('Show one file')).action(runShow);
  command(program, 'similar <file>', t('List similar files'))
    .option('--limit <n>', t('Files to list'), Number)
    .action(runSimilar);
  command(program, 'review', t('List items waiting for a person, or resolve them'))
    .option('--tag <tag>', t('Only this tag'))
    .option('--limit <n>', t('Items to list'), Number)
    .option('--accept <ids>', t('Accept comma-separated ids, or all'))
    .option('--reject <ids>', t('Reject comma-separated ids, or all'))
    .action(runReview);
  command(program, 'suggest <file>', t('Ask the chat model for candidate tags')).action(runSuggest);
  command(program, 'cleanup', t('Report near-duplicate, one-file and over-broad tags')).action(
    runCleanup,
  );
}
