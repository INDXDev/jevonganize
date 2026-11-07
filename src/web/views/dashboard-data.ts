/**
 * The Dashboard's figures, worked out from `usage_report` and `library_report`. Pure functions of
 * their input, with no React and no clock of their own, so tests can check every number.
 */
import type { LibraryReport, UsageFeature, UsageReport, UsageTotals } from '../../tool-map.ts';

/** The periods a person can pick, in days, each ending today. */
export const PERIODS = [7, 30, 90] as const;

/** One of `PERIODS`. */
export type Period = (typeof PERIODS)[number];

/** Reads the `period` param. Anything else falls back to 30 days. */
export const periodOf = (value?: string): Period =>
  PERIODS.find((days) => String(days) === value) ?? 30;

/** The local midnight `days - 1` days before `now`, so the period ends with today. */
export const periodStart = (days: number, now: Date): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();

const pad = (n: number) => String(n).padStart(2, '0');

/** A local day as `YYYY-MM-DD`, the way `usage_report` names a day's bucket. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every day of the period, oldest first, including days with no calls. */
export function periodDays(days: number, now: Date): string[] {
  const first = new Date(periodStart(days, now));
  return Array.from({ length: days }, (_, index) =>
    localDay(new Date(first.getFullYear(), first.getMonth(), first.getDate() + index)),
  );
}

/**
 * The features the chart stacks, bottom first. The order fixes each one's colour, so a feature keeps
 * its colour whichever others are present. `organize-cache` costs nothing, so it has no bar.
 */
export const CHART_FEATURES = [
  'organize',
  'names',
  'suggest',
  'topics',
  'refresh',
  'chat',
] as const satisfies readonly UsageFeature[];

/** A feature the chart draws. */
export type ChartFeature = (typeof CHART_FEATURES)[number];

/** One day's cost, split by feature in `CHART_FEATURES` order. */
export type DayStack = { day: string; costs: { feature: ChartFeature; cost: number }[] };

/** Each day's cost by feature. A day or feature with no rows costs 0. */
export function dailyStacks(
  rows: UsageReport['by_bucket_feature'],
  days: readonly string[],
): DayStack[] {
  const cost = new Map(rows.map((row) => [`${row.start}|${row.feature}`, row.cost_usd]));
  return days.map((day) => ({
    day,
    costs: CHART_FEATURES.map((feature) => ({ feature, cost: cost.get(`${day}|${feature}`) ?? 0 })),
  }));
}

/** A stacked segment, in the chart's own units: `y` grows downwards, as in SVG. */
export type Segment = { feature: ChartFeature; cost: number; y: number; height: number };

/** A day's bar. `segments` leaves out features that cost nothing that day. */
export type Bar = { day: string; total: number; x: number; width: number; segments: Segment[] };

/** The size of the drawing, and the space between bars and between segments. */
export type ChartBox = { width: number; height: number; gap: number };

/**
 * Lays out one bar per day across `box`, scaled so the most expensive day fills the height. Each
 * segment gives up `box.gap` at its top, so stacked fills stay apart.
 */
export function layoutBars(
  stacks: readonly DayStack[],
  box: ChartBox,
): { bars: Bar[]; max: number } {
  const totals = stacks.map(({ costs }) => costs.reduce((sum, { cost }) => sum + cost, 0));
  const max = Math.max(0, ...totals);
  const step = stacks.length ? box.width / stacks.length : 0;
  const scale = max > 0 ? box.height / max : 0;
  const bars = stacks.map(({ day, costs }, index) => {
    let top = box.height;
    const segments: Segment[] = [];
    for (const { feature, cost } of costs) {
      if (cost <= 0) continue;
      const full = cost * scale;
      top -= full;
      segments.push({ feature, cost, y: top + box.gap, height: Math.max(full - box.gap, 0.5) });
    }
    return {
      day,
      total: totals[index]!,
      x: index * step,
      width: Math.max(step - box.gap, 1),
      segments,
    };
  });
  return { bars, max };
}

/** Tokens both ways: the figure a job's block and the status bar show. */
export const totalTokens = (totals: Pick<UsageTotals, 'input_tokens' | 'output_tokens'>) =>
  totals.input_tokens + totals.output_tokens;

/** One day's tokens and cost, from a report bucketed by day. A day with no calls is zero. */
export function dayTotals(report: Pick<UsageReport, 'by_bucket'>, day: string) {
  const bucket = report.by_bucket.find((row) => row.start === day);
  return { tokens: bucket ? totalTokens(bucket) : 0, cost_usd: bucket?.cost_usd ?? 0 };
}

/** Indexed and organized files over every library, and the share organized: 0 to 1, null with none. */
export function organizedShare(libraries: LibraryReport['libraries']) {
  const files = libraries.reduce((sum, library) => sum + library.files, 0);
  const organized = libraries.reduce((sum, library) => sum + library.organized, 0);
  return { files, organized, share: files ? organized / files : null };
}
