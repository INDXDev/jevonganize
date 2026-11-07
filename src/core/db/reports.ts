/** The numbers behind `usage_report` and `library_report`. Everything is read from this index. */
import type { LibraryReport, UsageFeature, UsageReport, UsageTotals } from '../../tool-map.ts';
import type { Sql } from './connection.ts';
import { folderRange } from './paths.ts';

/** How `usage_report` groups rows in time. */
export type UsageBucket = 'day' | 'week' | 'month';

/** A time range: `since` included, `until` left out, both in milliseconds since the epoch. */
export interface UsageRange {
  since: number;
  until: number;
}

/** Each bucket's first local day. A week starts on Monday: back six days, then on to a Monday. */
const BUCKET_START: Record<UsageBucket, string> = {
  day: `date(at / 1000, 'unixepoch', 'localtime')`,
  week: `date(at / 1000, 'unixepoch', 'localtime', '-6 days', 'weekday 1')`,
  month: `date(at / 1000, 'unixepoch', 'localtime', 'start of month')`,
};

/** Rows that count files served from the cache: no model was called, so they are no call. */
const SUMS = `
  coalesce(sum(feature <> 'organize-cache'), 0) AS calls,
  coalesce(sum(files), 0) AS files,
  coalesce(sum(input_tokens), 0) AS input_tokens,
  coalesce(sum(output_tokens), 0) AS output_tokens,
  coalesce(sum(cost_usd), 0) AS cost_usd,
  coalesce(sum(cost_usd IS NULL), 0) AS unknown_cost_calls`;

/** Usage in the range, in total, by bucket, by feature, by bucket and feature, and by model. */
export function usageReport(sql: Sql, range: UsageRange, bucket: UsageBucket): UsageReport {
  const where = 'WHERE at >= ? AND at < ?';
  const params = [range.since, range.until];
  const totals = sql.get<UsageTotals>(`SELECT ${SUMS} FROM usage ${where}`, ...params)!;
  const by_bucket = sql.all<UsageTotals & { start: string }>(
    `SELECT ${BUCKET_START[bucket]} AS start, ${SUMS} FROM usage ${where}
     GROUP BY start ORDER BY start`,
    ...params,
  );
  const by_feature = sql.all<UsageTotals & { feature: UsageFeature }>(
    `SELECT feature, ${SUMS} FROM usage ${where} GROUP BY feature ORDER BY feature`,
    ...params,
  );
  const by_bucket_feature = sql.all<UsageTotals & { start: string; feature: UsageFeature }>(
    `SELECT ${BUCKET_START[bucket]} AS start, feature, ${SUMS} FROM usage ${where}
     GROUP BY start, feature ORDER BY start, feature`,
    ...params,
  );
  const by_model = sql.all<UsageTotals & { provider: string; model: string }>(
    `SELECT provider, model, ${SUMS} FROM usage ${where}
     GROUP BY provider, model ORDER BY provider, model`,
    ...params,
  );
  return { totals, by_bucket, by_feature, by_bucket_feature, by_model };
}

/** Each library with its files counted by state. */
export function libraryCounts(sql: Sql): LibraryReport['libraries'] {
  const libraries = sql.all<{ path: string; scanned_at: number | null }>(
    'SELECT path, scanned_at FROM library ORDER BY path',
  );
  return libraries.map(({ path, scanned_at }) => {
    const counts = sql.get<{ files: number; organized: number; failed: number; tagged: number }>(
      `SELECT count(*) AS files,
         coalesce(sum(status = 'organized'), 0) AS organized,
         coalesce(sum(status = 'failed'), 0) AS failed,
         coalesce(sum(EXISTS (SELECT 1 FROM file_tag ft WHERE ft.file_id = f.id)), 0) AS tagged
       FROM file f WHERE path >= ? AND path < ?`,
      ...folderRange(path),
    )!;
    return { path, ...counts, scanned_at };
  });
}

/** Files by the part of their MIME type before the slash, most first. */
export function kindCounts(sql: Sql): LibraryReport['kinds'] {
  return sql.all(
    `SELECT CASE WHEN instr(mime, '/') > 0 THEN substr(mime, 1, instr(mime, '/') - 1)
       WHEN mime IS NULL OR mime = '' THEN 'unknown' ELSE mime END AS mime_group,
       count(*) AS files
     FROM file GROUP BY mime_group ORDER BY files DESC, mime_group`,
  );
}

/** Plans by status, the three a person cares about. */
export function planCounts(sql: Sql): LibraryReport['plans'] {
  const rows = sql.all<{ status: string; n: number }>(
    'SELECT status, count(*) AS n FROM plan GROUP BY status',
  );
  const count = (status: string) => rows.find((row) => row.status === status)?.n ?? 0;
  return { applied: count('applied'), undone: count('undone'), proposed: count('proposed') };
}

/** How many raw answers the cache holds. */
export const answerCount = (sql: Sql) =>
  sql.get<{ n: number }>('SELECT count(*) AS n FROM answer')!.n;

/**
 * The share of files organized since `since` that cost no model call. Each `organize-cache` row
 * counts such files, and each `organize` row one file asked. Null when there were none.
 */
export function cacheHitRate(sql: Sql, since: number): number | null {
  const { cached, asked } = sql.get<{ cached: number; asked: number }>(
    `SELECT coalesce(sum(CASE WHEN feature = 'organize-cache' THEN files END), 0) AS cached,
       coalesce(sum(CASE WHEN feature = 'organize' THEN files END), 0) AS asked
     FROM usage WHERE at >= ?`,
    since,
  )!;
  const total = cached + asked;
  return total === 0 ? null : cached / total;
}
