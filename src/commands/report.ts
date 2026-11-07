/** `jevonganize report`: model usage and the state of the index. Thin: tools do the work. */
import type { LibraryReport, UsageTotals } from '../tool-map.ts';
import { getLanguage, t } from './i18n/index.ts';
import type { Command } from 'commander';
import { UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import {
  callTool,
  command,
  count,
  type JsonFlag,
  out,
  outJson,
  shown,
  withContext,
} from './shared.ts';

const BUCKETS = ['day', 'week', 'month'] as const;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface UsageFlags extends JsonFlag {
  since?: string;
  until?: string;
  bucket?: string;
}

/** A `YYYY-MM-DD` flag as the start of that local day, in milliseconds. */
function localDay(value: string, flag: string): number {
  const [, year, month, day] = LOCAL_DATE.exec(value) ?? [];
  const time = new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  if (!year || Number.isNaN(time)) {
    throw new UserError(t('{flag} needs a date such as 2026-11-01', { flag }));
  }
  return time;
}

/** The `bucket` flag, checked. */
function bucketOf(value: string | undefined): (typeof BUCKETS)[number] | undefined {
  if (value === undefined) return undefined;
  const found = BUCKETS.find((bucket) => bucket === value);
  if (!found) throw new UserError(t('--bucket is day, week or month'));
  return found;
}

const compact = (value: number) =>
  new Intl.NumberFormat(getLanguage(), { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );

/** One line of totals: calls, tokens each way, and the known cost. */
function totalsLine(totals: UsageTotals): string {
  const unknown =
    totals.unknown_cost_calls > 0
      ? t(' ({count} calls with no known price)', { count: count(totals.unknown_cost_calls) })
      : '';
  return t('{calls} calls, {input} tokens in, {output} out, about ${cost}{unknown}', {
    calls: count(totals.calls),
    input: compact(totals.input_tokens),
    output: compact(totals.output_tokens),
    cost: totals.cost_usd.toFixed(2),
    unknown,
  });
}

async function runUsage(flags: UsageFlags): Promise<void> {
  await withContext(flags, async (ctx) => {
    const input = {
      ...(flags.since !== undefined && { since: localDay(flags.since, '--since') }),
      ...(flags.until !== undefined && { until: localDay(flags.until, '--until') }),
      ...(flags.bucket !== undefined && { bucket: bucketOf(flags.bucket) }),
    };
    const report = await callTool('usage_report', input, ctx);
    if (flags.json) return outJson(report);
    out(totalsLine(report.totals));
    for (const row of report.by_bucket) out(`  ${row.start}  ${totalsLine(row)}`);
    for (const row of report.by_feature) out(`  ${row.feature}  ${totalsLine(row)}`);
    for (const row of report.by_model) out(`  ${row.provider} ${row.model}  ${totalsLine(row)}`);
    return undefined;
  });
}

/** The lines of a library report. */
function printLibrary(report: LibraryReport): void {
  for (const library of report.libraries) {
    const values = {
      path: shown(library.path),
      files: count(library.files),
      organized: count(library.organized),
      tagged: count(library.tagged),
      failed: count(library.failed),
    };
    out(
      t('{path}: {files} files, {organized} organized, {tagged} tagged, {failed} failed', values),
    );
  }
  for (const { mime_group, files } of report.kinds)
    out(`  ${sanitizeLine(mime_group)}  ${count(files)}`);
  for (const { tag, count: files } of report.top_tags)
    out(`  ${sanitizeLine(tag)}  ${count(files)}`);
  const { applied, undone, proposed } = report.plans;
  out(t('Open reviews: {count}', { count: count(report.reviews_open) }));
  out(
    t('Plans: {applied} applied, {undone} undone, {proposed} proposed', {
      applied: count(applied),
      undone: count(undone),
      proposed: count(proposed),
    }),
  );
  const rate = report.cache.hit_rate_30d;
  const share = rate === null ? '-' : `${Math.round(rate * 100)}%`;
  out(
    t('Answer cache: {answers} answers, {share} of files free in 30 days', {
      answers: count(report.cache.answers),
      share,
    }),
  );
}

async function runLibrary(flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const report = await callTool('library_report', {}, ctx);
    if (flags.json) return outJson(report);
    return printLibrary(report);
  });
}

/** Adds `report usage` and `report library`. */
export function addReportCommands(program: Command): void {
  const report = program
    .command('report')
    .description(t('Model usage and the state of the index. Free and local'));
  command(report, 'usage', t('Tokens and estimated cost of the model calls made here'))
    .option('--since <date>', t('From this local day, such as 2026-11-01'))
    .option('--until <date>', t('Up to, not including, this local day'))
    .option('--bucket <size>', t('day, week or month (day)'))
    .action(runUsage);
  command(
    report,
    'library',
    t('Files per library, kinds, top tags, reviews, plans and cache'),
  ).action(runLibrary);
}
