import type { UsageFeature } from '../src/tool-map.ts';
import { describe, expect, test } from 'vitest';
import type { Context } from '../src/core/tools.ts';
import { tools } from '../src/core/tools.ts';
import type { UsageRecord } from '../src/core/db.ts';
import { addFile, db, item, native, plan, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

/** Noon on a local day, so no time zone moves a row into the next or last day. */
const noon = (month: number, day: number) => new Date(2026, month - 1, day, 12).getTime();

/** Stores one call of 100 tokens in and 10 out at `at`, priced or not. */
function call(at: number, feature: UsageFeature = 'organize', cost: number | null = 0.01): void {
  const row: UsageRecord = {
    at,
    feature,
    provider: 'openai',
    model: 'gpt-6-luna',
    input_tokens: 100,
    output_tokens: 10,
    cost_usd: cost,
    job_id: null,
    files: feature === 'chat' ? 0 : 1,
  };
  db.recordUsage(row);
}

/** Runs a tool on the test's index, as a person. */
const run = <K extends 'usage_report' | 'library_report'>(
  name: K,
  input: Parameters<(typeof tools)[K]['run']>[0],
) => tools[name].run(input, { db, caller: 'cli' } as Context);

const everything = { since: noon(1, 1), until: noon(12, 31) };

describe('usage_report in time', () => {
  test('buckets by local day, week from Monday, and month, oldest first', async () => {
    // Monday 2 Nov, Wednesday 4 Nov, Sunday 8 Nov, Monday 9 Nov, then 1 Dec.
    for (const day of [2, 4, 8, 9]) call(noon(11, day));
    call(noon(12, 1));
    const byDay = await run('usage_report', { ...everything, bucket: 'day' });
    expect(byDay.by_bucket.map((row) => [row.start, row.calls])).toEqual([
      ['2026-11-02', 1],
      ['2026-11-04', 1],
      ['2026-11-08', 1],
      ['2026-11-09', 1],
      ['2026-12-01', 1],
    ]);
    const byWeek = await run('usage_report', { ...everything, bucket: 'week' });
    expect(byWeek.by_bucket.map((row) => [row.start, row.calls])).toEqual([
      ['2026-11-02', 3],
      ['2026-11-09', 1],
      ['2026-11-30', 1],
    ]);
    const byMonth = await run('usage_report', { ...everything, bucket: 'month' });
    expect(byMonth.by_bucket.map((row) => [row.start, row.calls])).toEqual([
      ['2026-11-01', 4],
      ['2026-12-01', 1],
    ]);
  });

  test('leaves out rows before since and from until on', async () => {
    call(noon(11, 1));
    call(noon(11, 2));
    call(noon(11, 3));
    const report = await run('usage_report', { since: noon(11, 2), until: noon(11, 3) });
    expect(report.totals).toMatchObject({ calls: 1, input_tokens: 100, output_tokens: 10 });
  });
});

describe('usage_report totals', () => {
  test('adds known costs, and counts the calls with none', async () => {
    call(noon(11, 2), 'organize', 0.01);
    call(noon(11, 2), 'chat', null);
    call(noon(11, 2), 'chat', null);
    const { totals, by_feature, by_model } = await run('usage_report', everything);
    expect(totals).toEqual({
      calls: 3,
      files: 1,
      input_tokens: 300,
      output_tokens: 30,
      cost_usd: 0.01,
      unknown_cost_calls: 2,
    });
    expect(by_feature.map((row) => [row.feature, row.calls, row.unknown_cost_calls])).toEqual([
      ['chat', 2, 2],
      ['organize', 1, 0],
    ]);
    expect(by_model).toEqual([expect.objectContaining({ model: 'gpt-6-luna', calls: 3 })]);
  });

  test('splits each bucket by feature, for the stacked chart', async () => {
    call(noon(11, 2), 'organize', 0.01);
    call(noon(11, 2), 'chat', 0.02);
    call(noon(11, 3), 'organize', 0.01);
    const { by_bucket_feature } = await run('usage_report', everything);
    expect(by_bucket_feature.map((row) => [row.start, row.feature, row.cost_usd])).toEqual([
      ['2026-11-02', 'chat', 0.02],
      ['2026-11-02', 'organize', 0.01],
      ['2026-11-03', 'organize', 0.01],
    ]);
  });

  test('a cache row counts files, not calls', async () => {
    db.recordUsage({ ...cacheRow(), at: noon(11, 2) });
    const { totals } = await run('usage_report', everything);
    expect(totals).toMatchObject({ calls: 0, files: 4, cost_usd: 0, unknown_cost_calls: 0 });
  });

  test('an empty range is all zeros, and an inverted one is refused', async () => {
    const empty = await run('usage_report', everything);
    expect(empty).toEqual({
      totals: {
        calls: 0,
        files: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        unknown_cost_calls: 0,
      },
      by_bucket: [],
      by_feature: [],
      by_bucket_feature: [],
      by_model: [],
    });
    await expect(run('usage_report', { since: 10, until: 10 })).rejects.toThrow('until');
  });

  test('rows older than a year go when the index is opened', () => {
    const now = Date.now();
    call(now - 400 * 24 * 60 * 60 * 1000);
    call(now);
    expect(db.pruneUsage(now - 365 * 24 * 60 * 60 * 1000)).toBe(1);
  });
});

const cacheRow = (): UsageRecord => ({
  at: 0,
  feature: 'organize-cache',
  provider: 'openai',
  model: 'gpt-6-luna',
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  job_id: 'j',
  files: 4,
});

describe('library_report', () => {
  test('counts files per library by state, kinds, tags, reviews, plans and the cache', async () => {
    db.addLibrary(native('/lib'));
    db.addLibrary(native('/other'));
    const pdf = addFile(native('/lib/a.pdf'));
    const jpg = addFile(native('/lib/b.jpg'));
    const odd = addFile(native('/lib/c'));
    addFile(native('/other/d.txt'));
    db.setFileResult(pdf, { status: 'organized', mime: 'application/pdf' });
    db.setFileResult(jpg, { status: 'failed', error: 'broken', mime: 'image/jpeg' });
    db.setFileResult(odd, { status: 'organized', mime: 'odd' });
    db.addFileTags(pdf, ['topic:tax', 'year:2026'], false);
    db.addFileTags(jpg, ['topic:tax'], false);
    db.addReview(item(pdf, 'topic:law'));
    db.savePlan(plan('p1', 1, 'applied'));
    db.savePlan(plan('p2', 2, 'applied'));
    db.savePlan(plan('p3', 3, 'proposed'));
    db.putAnswer('k', 'topic', []);
    db.recordUsage({ ...cacheRow(), at: Date.now(), files: 1 });
    call(Date.now());
    call(Date.now());
    call(Date.now() - 40 * 24 * 60 * 60 * 1000);

    const report = await run('library_report', {});
    expect(report.libraries).toEqual([
      { path: native('/lib'), files: 3, organized: 2, tagged: 2, failed: 1, scanned_at: null },
      { path: native('/other'), files: 1, organized: 0, tagged: 0, failed: 0, scanned_at: null },
    ]);
    expect(report.kinds).toEqual([
      { mime_group: 'application', files: 1 },
      { mime_group: 'image', files: 1 },
      { mime_group: 'odd', files: 1 },
      { mime_group: 'unknown', files: 1 },
    ]);
    expect(report.top_tags.map((row) => [row.tag, row.count])).toEqual([
      ['topic:tax', 2],
      ['year:2026', 1],
    ]);
    expect(report.reviews_open).toBe(1);
    expect(report.plans).toEqual({ applied: 2, undone: 0, proposed: 1 });
    expect(report.cache.answers).toBe(1);
    expect(report.cache.hit_rate_30d).toBeCloseTo(1 / 3);
  });

  test('with nothing organized lately, the hit rate is unknown', async () => {
    expect((await run('library_report', {})).cache.hit_rate_30d).toBeNull();
  });
});
