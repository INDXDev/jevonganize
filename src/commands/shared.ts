/** What every command shares: output, flags, and waiting for jobs. Only this layer prints. */
import { homedir } from 'node:os';
import { sep } from 'node:path';
import type { Command } from 'commander';
import { indexedPath, UserError } from '../core/config.ts';
import { sanitize, sanitizeLine } from '../core/sanitize.ts';
import { callTool, type Context, openContext, waitForJob } from '../core/tools.ts';
import type { Estimate, FileQuery, Job, Plan } from '../types.ts';

/** Exit status of a run stopped with Ctrl-C, as a shell would report it. */
const EXIT_CANCELLED = 130;
const SHOWN_TAGS = 2;

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
  const short = path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
  return sanitizeLine(short);
}

export const count = (value: number) => value.toLocaleString('en-US');

/** The commander `.option` collector for a repeatable flag. */
export const repeat = (value: string, list: string[] = []) => [...list, value];

export const commaList = (value: string) => value.split(',').filter(Boolean);

/** Adds a command with `--json`. */
export const command = (parent: Command, spec: string, description: string) =>
  parent.command(spec).description(description).option('--json', 'Print JSON');

/** Adds the query flags of docs/cli.md. */
export const queryFlags = (target: Command) =>
  target
    .option('--folder <path>', 'Only this folder')
    .option('--tag <tag>', 'Has this tag. Repeatable', repeat)
    .option('--not-tag <tag>', 'Lacks this tag. Repeatable', repeat)
    .option('--mime <type>', 'MIME type, such as image/*')
    .option('--status <status>', 'new, organized or failed')
    .option('--sort <key>', 'name, modified, size or relevance')
    .option('--order <order>', 'asc or desc')
    .option('--limit <n>', 'At most this many', Number)
    .option('--offset <n>', 'Skip this many', Number);

/** The values of `queryFlags`. */
export interface QueryFlags {
  folder?: string;
  tag?: string[];
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
  const { folder, tag, notTag, mime, status, sort, order, limit, offset } = flags;
  const query: FileQuery = {
    folder: folder === undefined ? undefined : indexedPath(folder),
    tags: tag,
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

function progress(job: Job): void {
  if (!process.stderr.isTTY) return;
  const verb = { scan: 'Scanning', organize: 'Organizing', apply: 'Applying', undo: 'Undoing' }[
    job.kind
  ];
  const end = job.status === 'running' ? '\r' : '\n';
  process.stderr.write(`\x1b[2K${verb} ${count(job.done)}/${count(job.total)}${end}`);
}

/** Runs `work` with an open index. Job progress goes to stderr, or to stdout as NDJSON. */
export async function withContext<T>(
  flags: JsonFlag,
  work: (ctx: Context) => Promise<T>,
  caller: Context['caller'] = 'cli',
): Promise<T> {
  const ctx = await openContext(caller, (event) => {
    if (event.type !== 'job') return;
    if (flags.json) outJson(event.job);
    else progress(event.job);
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
  const final = await waitForJob(job.id);
  process.off('SIGINT', cancel);
  for (const warning of final.warnings ?? []) note(sanitizeLine(warning));
  if (final.status === 'failed') throw new UserError(final.error ?? 'The job failed');
  if (final.status === 'cancelled') {
    note('Cancelled.');
    process.exitCode = EXIT_CANCELLED;
  }
  return final;
}

/** Adds up a plan summary's per-tag counts. */
export const sum = (tags: Record<string, number>) =>
  Object.values(tags).reduce((total, value) => total + value, 0);

/** The middle lines of a plan's report. */
export function printPlan(plan: Plan): void {
  const { files, added, removed } = plan.summary;
  out(`Plan ${plan.id}: ${sanitizeLine(plan.title)}`);
  out(`  ${count(files)} files, ${count(sum(added))} tags added, ${count(sum(removed))} removed`);
}

/** Applies a plan and reports it. Exit 1 when an op failed. */
export async function applyAndReport(ctx: Context, id: string, json?: boolean): Promise<void> {
  const final = await follow(ctx, await callTool('apply_plan', { id }, ctx));
  const plan = await callTool('get_plan', { id }, ctx);
  reportErrors(plan);
  if (final.status === 'cancelled') return;
  if (json) return;
  out(
    `Applied ${id}: ${count(plan.summary.files)} files, ${count(sum(plan.summary.added))} tags added.`,
  );
  out(`Undo: jevonganize undo ${id}`);
}

/** Lists failed ops on stderr, and sets exit 1. */
export function reportErrors(plan: Plan): void {
  const errors = Object.entries(plan.errors ?? {});
  for (const [id, reason] of errors) note(`File ${id}: ${sanitizeLine(reason)}`);
  if (errors.length > 0 && !process.exitCode) process.exitCode = 1;
}

/** The cost line of an estimate. */
export function costLine({ tokens, cost_usd, provider, model }: Estimate): string {
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const cost = cost_usd === null ? 'cost unknown' : `about $${cost_usd.toFixed(2)}`;
  return `About ${compact.format(tokens)} tokens, ${cost} on ${provider} ${model}`;
}

/** A row's tags, cut for a table. */
export function someTags(tags: string[]): string {
  const rest = tags.length - SHOWN_TAGS;
  return [...tags.slice(0, SHOWN_TAGS), ...(rest > 0 ? [`+${rest}`] : [])]
    .map(sanitizeLine)
    .join(' ');
}

/** A `<file>` argument: an id, or a path looked up in the index. */
export async function fileArg(arg: string, ctx: Context) {
  const input = /^\d+$/.test(arg) ? { id: Number(arg) } : { path: indexedPath(arg) };
  return callTool('get_file', input, ctx);
}
