/**
 * Recording model usage. `ai/` reports what each call billed and stores nothing; the flows and tools
 * that made the call turn it into a `usage` row here. Rows stay in the local index.
 */
import type { UsageFeature } from '../tool-map.ts';
import { estimateCost, type OnUsage, type PricedModel, type TokenUsage } from '../ai/pricing.ts';
import type { Db, UsageRecord } from './db.ts';

/** What a row adds beyond the call itself. */
export interface UsageExtra {
  job_id?: string | null;
  /** Files the call worked on. Chat works on none. */
  files?: number;
}

/** One call as a `usage` row, priced now. */
export function usageRecord(
  feature: UsageFeature,
  model: PricedModel,
  tokens: TokenUsage,
  { job_id = null, files = 0 }: UsageExtra = {},
): UsageRecord {
  return {
    at: Date.now(),
    feature,
    provider: model.provider,
    model: model.modelId,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cost_usd: estimateCost(tokens, model),
    job_id,
    files,
  };
}

/** A listener for `ai/` that stores each call it hears as a row of `feature`. */
export const usageRecorder =
  (db: Db, feature: UsageFeature, extra: UsageExtra = {}): OnUsage =>
  (model, tokens) =>
    db.recordUsage(usageRecord(feature, model, tokens, extra));

/** The row that counts a run's files that cost no model call, for the cache hit rate. */
export function cacheRecord(model: PricedModel, files: number, job_id: string | null): UsageRecord {
  const row = usageRecord('organize-cache', model, { input: 0, output: 0 }, { job_id, files });
  // An unknown price would make these free files look like calls of unknown cost.
  return { ...row, cost_usd: 0 };
}

/** What a job shows: tokens both ways, and USD, null once any call has no known price. */
export interface UsageTally {
  tokens: number;
  cost: number | null;
}

/** Adds one call to a job's tally, priced as its `usage` row is, so the two always agree. */
export function addToTally(tally: UsageTally, tokens: TokenUsage, model: PricedModel): void {
  tally.tokens += tokens.input + tokens.output;
  const price = estimateCost(tokens, model);
  tally.cost = tally.cost === null || price === null ? null : tally.cost + price;
}

/** One file's calls to one model, counted as they are heard. */
export interface CallMeter {
  calls: number;
  tokens: TokenUsage;
  /** The listener to hand to `ai/`. */
  onTokens: (tokens: TokenUsage) => void;
}

/**
 * Counts one file's calls to one model. Each call goes into the job's tally at once, and the caller
 * stores the meter's total as one `usage` row when the file is done with that model.
 */
export function callMeter(tally: UsageTally, model: PricedModel): CallMeter {
  const meter: CallMeter = {
    calls: 0,
    tokens: { input: 0, output: 0 },
    onTokens: (tokens) => {
      meter.calls++;
      meter.tokens.input += tokens.input;
      meter.tokens.output += tokens.output;
      addToTally(tally, tokens, model);
    },
  };
  return meter;
}
