/** Model usage: one row per recorded call. It stays in this index and is never sent anywhere. */
import type { UsageFeature } from '../../tool-map.ts';
import type { Sql } from './connection.ts';

/** One recorded model call, as stored. */
export interface UsageRecord {
  /** Milliseconds since the epoch. */
  at: number;
  feature: UsageFeature;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Null when the model has no known price. */
  cost_usd: number | null;
  job_id: string | null;
  files: number;
}

/** Stores one model call. */
export function recordUsage(sql: Sql, row: UsageRecord): void {
  sql.run(
    `INSERT INTO usage (at, feature, provider, model, input_tokens, output_tokens, cost_usd,
       job_id, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.at,
    row.feature,
    row.provider,
    row.model,
    row.input_tokens,
    row.output_tokens,
    row.cost_usd,
    row.job_id,
    row.files,
  );
}

/** Deletes the rows recorded before `before`. Returns how many went. */
export function pruneUsage(sql: Sql, before: number): number {
  return Number(sql.run('DELETE FROM usage WHERE at < ?', before).changes);
}

/** The rows of one job, oldest first. */
export function jobUsage(sql: Sql, jobId: string): UsageRecord[] {
  return sql.all<UsageRecord>(
    `SELECT at, feature, provider, model, input_tokens, output_tokens, cost_usd, job_id, files
     FROM usage WHERE job_id = ? ORDER BY id`,
    jobId,
  );
}
