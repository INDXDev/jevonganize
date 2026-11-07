/** What every command shares: output, flags, and waiting for jobs. Only this layer prints. */
import { t, getLanguage } from './i18n/index.ts';
import { homedir } from 'node:os';
import { sep } from 'node:path';
import type { Command } from 'commander';
import { indexedPath, UserError } from '../core/config.ts';
import { sanitize, sanitizeLine } from '../core/sanitize.ts';
import type * as ToolTable from '../core/tools.ts';
import type { Context } from '../core/tools.ts';
import type { Estimate, FileQuery, Job, Plan } from '../types.ts';

/** Exit status of a run stopped with Ctrl-C, as a shell would report it. */
const EXIT_CANCELLED = 130;
/** Tags a table row shows before it folds the rest into `+n`. */
const SHOWN_TAGS = 2;

/** The table loads on first use: it brings in every engine, which `--help` has no use for. */
const toolTable = () => import('../core/tools.ts');
/** `callTool`, for commands. */
export const callTool: typeof ToolTable.callTool = async (name, input, ctx) =>
  (await toolTable()).callTool(name, input, ctx);

/** Flags every command has. */
export interface JsonFlag {
  json?: boolean;
}

/** Prints a result. Untrusted text is made safe here, at the boundary. */
export const out = (text = '') => void process.stdout.write(`${sanitize(text)}\n`);
/** Prints a warning or progress. */
export const note = (text = '') => void process.stderr.write(`${sanitize(text)}\n`);
/** Prints a value with its original text. `--json` output is untrusted by contract. */
export const outJson = (value: unknown) =>
  void process.stdout.write(`${JSON.stringify(value ?? null)}\n`);

/** A path for a table: one line, and short. */
export function shown(path: string): string {
  const home = homedir();
  const isUnderHome = path === home || path.startsWith(home + sep);
  return sanitizeLine(isUnderHome ? `~${path.slice(home.length)}` : path);
}

/** A number in the reader's language, such as 1,234. */
export const count = (value: number) => value.toLocaleString(getLanguage());

/** The commander `.option` collector for a repeatable flag. */
export const repeat = (value: string, list: string[] = []) => [...list, value];

/** The commander parser for a comma-separated flag. Empty items are dropped. */
export const commaList = (value: string) => value.split(',').filter(Boolean);

/** Adds a command with `--json`. */
export const command = (parent: Command, spec: string, description: string) =>
  parent.command(spec).description(description).option('--json', t('Print JSON'));

/** Adds the query flags of docs/cli.md. */
export const queryFlags = (target: Command) =>
  target
    .option('--folder <path>', t('Only this folder'))
    .option('--tag <tag>', t('Has this tag. Repeatable'), repeat)
    .option('--tag-match <mode>', t('Repeated --tag: all (the default) or any'))
    .option('--not-tag <tag>', t('Lacks this tag. Repeatable'), repeat)
    .option('--mime <type>', t('MIME type, such as image/*'))
    .option('--status <status>', t('new, organized or failed'))
    .option('--sort <key>', t('name, modified, size or relevance'))
    .option('--order <order>', t('asc or desc'))
    .option('--limit <n>', t('At most this many'), Number)
    .option('--offset <n>', t('Skip this many'), Number);

/** The values of `queryFlags`. */
export interface QueryFlags {
  folder?: string;
  tag?: string[];
  tagMatch?: FileQuery['tag_match'];
  notTag?: string[];
  mime?: string;
  status?: FileQuery['status'];
  sort?: FileQuery['sort'];
  order?: FileQuery['order'];
  limit?: number;
  offset?: number;
}

/** Turns flags into a `FileQuery`, leaving out what was not given. */
export function toQuery(flags: QueryFlags): FileQuery {
  const { folder, tag, tagMatch, notTag, mime, status, sort, order, limit, offset } = flags;
  const query: FileQuery = {
    folder: folder === undefined ? undefined : indexedPath(folder),
    tags: tag,
    tag_match: tagMatch,
    exclude_tags: notTag,
    mime,
    status,
    sort,
    order,
    limit,
    offset,
  };
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
}

/** The word a progress line starts with, for each kind of job. */
const progressVerb = (kind: Job['kind']) =>
  ({
    scan: t('Scanning'),
    organize: t('Organizing'),
    apply: t('Applying'),
    undo: t('Undoing'),
    refresh: t('Checking'),
  })[kind];

/** One progress line on a terminal, redrawn in place until the job ends. */
function printProgress(job: Job): void {
  if (!process.stderr.isTTY) return;
  const clearLine = '\x1b[2K';
  const lineEnd = job.status === 'running' ? '\r' : '\n';
  const fraction = `${count(job.done)}/${count(job.total)}`;
  process.stderr.write(`${clearLine}${progressVerb(job.kind)} ${fraction}${lineEnd}`);
}

/** Runs `work` with an open index. Job progress goes to stderr, or to stdout as NDJSON. */
export async function withContext<T>(
  flags: JsonFlag,
  work: (ctx: Context) => Promise<T>,
  caller: Context['caller'] = 'cli',
): Promise<T> {
  const { openContext } = await toolTable();
  const ctx = await openContext(caller, (event) => {
    if (event.type !== 'job') return;
    if (flags.json) outJson(event.job);
    else printProgress(event.job);
  });
  try {
    return await work(ctx);
  } finally {
    ctx.db.close();
  }
}

/** Waits for a job. The first Ctrl-C cancels it, and the second is left to kill the process. */
export async function follow(ctx: Context, job: Job): Promise<Job> {
  const cancel = () => void callTool('cancel_job', { id: job.id }, ctx);
  process.once('SIGINT', cancel);
  const { waitForJob } = await toolTable();
  const finished = await waitForJob(job.id);
  process.off('SIGINT', cancel);
  for (const warning of finished.warnings ?? []) note(sanitizeLine(warning));
  if (finished.status === 'failed') throw new UserError(finished.error ?? t('The job failed'));
  if (finished.status === 'cancelled') {
    note(t('Cancelled.'));
    process.exitCode = EXIT_CANCELLED;
  }
  return finished;
}

/** Throws when a job had files to work on and every one of them failed. */
export function failIfEveryFileFailed(job: Job): void {
  const everyFileFailed = job.total > 0 && job.failed === job.total;
  if (everyFileFailed) throw new UserError(t('Every file failed. See the warnings above'));
}

/** Adds up a plan summary's per-tag counts. */
export const sum = (tags: Record<string, number>) =>
  Object.values(tags).reduce((total, value) => total + value, 0);

/** The middle lines of a plan's report. */
export function printPlan(plan: Plan): void {
  const { files, added, removed } = plan.summary;
  out(t('Plan {id}: {title}', { id: plan.id, title: sanitizeLine(plan.title) }));
  out(
    t('  {files} files, {added} tags added, {removed} removed', {
      files: count(files),
      added: count(sum(added)),
      removed: count(sum(removed)),
    }),
  );
  for (const { files: merging, into } of plan.merges ?? []) {
    const tag = sanitizeLine(into);
    out(t('  {files} files merge into existing {tag}', { files: count(merging), tag }));
  }
}

/** Applies a plan and reports it. Exit 1 when an op failed. */
export async function applyAndReport(ctx: Context, id: string, json?: boolean): Promise<void> {
  const finished = await follow(ctx, await callTool('apply_plan', { id }, ctx));
  const plan = await callTool('get_plan', { id }, ctx);
  reportErrors(plan);
  if (finished.status === 'cancelled' || json) return;
  out(
    t('Applied {id}: {files} files, {added} tags added.', {
      id,
      files: count(plan.summary.files),
      added: count(sum(plan.summary.added)),
    }),
  );
  out(t('Undo: jevonganize undo {id}', { id }));
}

/** Lists failed ops on stderr, and sets exit 1. */
export function reportErrors(plan: Plan): void {
  const errors = Object.entries(plan.errors ?? {});
  for (const [id, reason] of errors)
    note(t('File {id}: {reason}', { id, reason: sanitizeLine(reason) }));
  if (errors.length > 0 && !process.exitCode) process.exitCode = 1;
}

/** The cost line of an estimate. */
export function costLine({ tokens, cost_usd, provider, model }: Estimate): string {
  const compactNumber = new Intl.NumberFormat(getLanguage(), {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const costText =
    cost_usd === null ? t('cost unknown') : t('about ${cost}', { cost: cost_usd.toFixed(2) });
  return t('About {tokens} tokens, {cost} on {provider} {model}', {
    tokens: compactNumber.format(tokens),
    cost: costText,
    provider,
    model,
  });
}

/** A row's tags, cut for a table: the first few, then `+n` for the rest. */
export function someTags(tags: string[]): string {
  const hiddenCount = tags.length - SHOWN_TAGS;
  const cells = tags.slice(0, SHOWN_TAGS);
  if (hiddenCount > 0) cells.push(`+${hiddenCount}`);
  return cells.map(sanitizeLine).join(' ');
}

/** A `<file>` argument: an id, or a path looked up in the index. */
export async function fileArg(arg: string, ctx: Context) {
  const isId = /^\d+$/.test(arg);
  return callTool('get_file', isId ? { id: Number(arg) } : { path: indexedPath(arg) }, ctx);
}

/** Whether a path is a library, or inside one. */
export async function isInLibrary(path: string, ctx: Context): Promise<boolean> {
  const libraries = await callTool('list_libraries', {}, ctx);
  return libraries.some((library) => path === library.path || path.startsWith(library.path + sep));
}
