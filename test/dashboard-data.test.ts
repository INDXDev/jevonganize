import type { UsageReport } from '../src/tool-map.ts';
import { describe, expect, test } from 'vitest';
import {
  dailyStacks,
  dayTotals,
  layoutBars,
  localDay,
  organizedShare,
  periodDays,
  periodOf,
  periodStart,
} from '../src/web/views/dashboard-data.ts';

const totals = { calls: 1, files: 1, input_tokens: 100, output_tokens: 10, unknown_cost_calls: 0 };

describe('the period', () => {
  test('reads 7, 30 or 90 days, and anything else as 30', () => {
    expect([periodOf('7'), periodOf('90'), periodOf(undefined), periodOf('5')]).toEqual([
      7, 90, 30, 30,
    ]);
  });

  test('starts at local midnight and lists every day up to today, across a month end', () => {
    const now = new Date(2026, 10, 2, 15, 30);
    expect(periodStart(3, now)).toBe(new Date(2026, 9, 31).getTime());
    expect(periodDays(3, now)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(localDay(now)).toBe('2026-11-02');
  });
});

describe('the daily chart', () => {
  const rows: UsageReport['by_bucket_feature'] = [
    { start: '2026-11-01', feature: 'chat', cost_usd: 0.1, ...totals },
    { start: '2026-11-01', feature: 'organize', cost_usd: 0.3, ...totals },
    { start: '2026-11-02', feature: 'organize-cache', cost_usd: 0, ...totals },
  ];

  test('fills days with no calls with zeros, in the fixed feature order', () => {
    const stacks = dailyStacks(rows, ['2026-11-01', '2026-11-02']);
    expect(stacks[0]!.costs.filter((entry) => entry.cost > 0)).toEqual([
      { feature: 'organize', cost: 0.3 },
      { feature: 'chat', cost: 0.1 },
    ]);
    expect(stacks[1]!.costs.every((entry) => entry.cost === 0)).toBe(true);
  });

  test('scales the dearest day to the full height and stacks from the baseline up', () => {
    const stacks = dailyStacks(rows, ['2026-11-01', '2026-11-02']);
    const { bars, max } = layoutBars(stacks, { width: 100, height: 40, gap: 0 });
    expect(max).toBeCloseTo(0.4);
    expect(bars.map((bar) => [bar.x, bar.width])).toEqual([
      [0, 50],
      [50, 50],
    ]);
    const [organize, chat] = bars[0]!.segments;
    expect(organize).toMatchObject({ feature: 'organize', y: 10, height: 30 });
    expect(chat).toMatchObject({ feature: 'chat', y: 0 });
    expect(chat!.height).toBeCloseTo(10);
    expect(bars[1]!.segments).toEqual([]);
  });

  test('a period with no cost draws no segment and divides by nothing', () => {
    const { bars, max } = layoutBars(dailyStacks([], ['2026-11-01']), {
      width: 10,
      height: 10,
      gap: 2,
    });
    expect(max).toBe(0);
    expect(bars[0]!.segments).toEqual([]);
  });
});

describe('the cards', () => {
  test("a day's total adds tokens both ways, and a day with no calls is zero", () => {
    const report = { by_bucket: [{ start: '2026-11-01', cost_usd: 0.4, ...totals }] };
    expect(dayTotals(report, '2026-11-01')).toEqual({ tokens: 110, cost_usd: 0.4 });
    expect(dayTotals(report, '2026-11-02')).toEqual({ tokens: 0, cost_usd: 0 });
  });

  test('the organized share counts every library, and is null with no files', () => {
    const library = { path: '/a', tagged: 0, failed: 0, scanned_at: null };
    expect(
      organizedShare([
        { ...library, files: 3, organized: 1 },
        { ...library, files: 1, organized: 1 },
      ]),
    ).toEqual({ files: 4, organized: 2, share: 0.5 });
    expect(organizedShare([]).share).toBeNull();
  });
});
