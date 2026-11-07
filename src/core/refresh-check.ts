/**
 * Checking refresh candidates: each one is read and the decision model is asked the refresh
 * question about it. A yes sure enough for review becomes a review item, never a tag. A person
 * accepts the item, which builds a plan, and `apply_plan` writes it.
 *
 * Candidates run in parallel and share one `RefreshRun`. Hits wait in its tally and are stored
 * together at the end, so a cancelled or stopped run leaves no review item behind.
 */
import { lstat } from 'node:fs/promises';
import pLimit from 'p-limit';
import { decide } from '../ai/decide.ts';
import type { ResolvedModel } from '../ai/providers.ts';
import { extractFile, isFailed } from '../extract/index.ts';
import type { FileState, RefreshCandidate } from '../types.ts';
import { type Config, errorMessage, UserError } from './config.ts';
import type { Db } from './db.ts';
import { refusedPathTest } from './organize-setup.ts';
import type { JobRun } from './plans.ts';
import type { RefreshQuestion } from './tag-refresh.ts';
import { callMeter, usageRecord } from './usage.ts';

/** Words or tags a reason names, so it stays a few words long. */
const REASON_ITEMS = 3;

/** What a refresh run works with. */
export interface RefreshSetup {
  db: Db;
  config: Config;
  question: RefreshQuestion;
  model: ResolvedModel;
  candidates: RefreshCandidate[];
}

/** A candidate the model said yes to, waiting until the run ends. */
interface Hit {
  candidate: RefreshCandidate;
  confidence: number;
}

/** What a run has found so far. */
interface RefreshTally {
  done: number;
  failed: number;
  tokens: number;
  cost: number | null;
  warnings: string[];
  hits: Hit[];
  /** The error that stops the run: a rejected key, say. */
  fatal?: UserError;
}

/** A run in progress: its setup, its tally, and the limits its files share. */
interface RefreshRun extends RefreshSetup {
  tally: RefreshTally;
  isRefusedPath: (path: string) => boolean;
  modelLimit: ReturnType<typeof pLimit>;
  job: JobRun;
}

/** Why a candidate is in the review queue, in a few words. Every part is computed locally. */
export function refreshReason({ signals }: Pick<RefreshCandidate, 'signals'>): string {
  const { terms, tags, similar, name } = signals;
  const parts: string[] = [];
  if (terms.length > 0) parts.push(`words ${terms.slice(0, REASON_ITEMS).join(', ')}`);
  if (tags.length > 0) parts.push(`tags ${tags.slice(0, REASON_ITEMS).join(', ')}`);
  if (similar > 0) parts.push('similar files');
  if (name) parts.push('file name');
  const because = parts.length > 0 ? parts.join('; ') : 'like the tagged files';
  return `Refresh: ${because}`;
}

/**
 * Checks each candidate with the decision model and queues the hits for review. A rejected key
 * stops the run, and anything else fails one file. A cancelled run stores no review item.
 */
export async function refreshFiles(setup: RefreshSetup, job: JobRun): Promise<void> {
  const { db, config, candidates } = setup;
  const tally: RefreshTally = { done: 0, failed: 0, tokens: 0, cost: 0, warnings: [], hits: [] };
  const run: RefreshRun = {
    ...setup,
    tally,
    isRefusedPath: refusedPathTest(db, config),
    modelLimit: pLimit(config.concurrency),
    job,
  };
  // Twice the model limit, so reading keeps ahead of the model, as in organize.
  const fileLimit = pLimit(config.concurrency * 2);

  job.update({ total: candidates.length });
  await Promise.all(candidates.map((candidate) => fileLimit(() => checkInRun(run, candidate))));
  if (tally.fatal) throw tally.fatal;
  job.signal.throwIfAborted();

  const reviews = storeHits(setup, tally.hits);
  const { failed, warnings, tokens, cost } = tally;
  job.update({ reviews, failed, warnings, tokens, cost_usd: cost });
}

/** One candidate's turn in a run. */
async function checkInRun(run: RefreshRun, candidate: RefreshCandidate): Promise<void> {
  const { job, tally } = run;
  if (job.signal.aborted || tally.fatal) return;
  job.update({ current: candidate.path });
  await checkUnlessRefused(run, candidate);
  tally.done++;
  job.update({ done: tally.done, tokens: tally.tokens, cost_usd: tally.cost });
}

/** Checks a candidate, or skips it with a warning when its path may not be read. */
async function checkUnlessRefused(run: RefreshRun, candidate: RefreshCandidate): Promise<void> {
  if (run.isRefusedPath(candidate.path)) {
    run.tally.warnings.push(`Skipped ${candidate.path}: excluded`);
    return;
  }
  try {
    await checkCandidate(run, candidate);
  } catch (error) {
    recordFailure(run.tally, candidate.path, error);
  }
}

/** A `UserError`, such as a rejected key, stops the run. Any other error fails only this file. */
function recordFailure(tally: RefreshTally, path: string, error: unknown): void {
  if (error instanceof UserError) {
    tally.fatal ??= error;
    return;
  }
  tally.failed++;
  tally.warnings.push(`${path}: ${errorMessage(error)}`);
}

/** Reads one candidate and asks about it. A hit waits in the tally until the run ends. */
async function checkCandidate(run: RefreshRun, candidate: RefreshCandidate): Promise<void> {
  const { db, config, question, tally } = run;
  const stats = await lstat(candidate.path);
  if (!stats.isFile()) throw new Error('not a regular file');
  const state = await extractFile(candidate.path, config);
  if (isFailed(state)) throw new Error(state.warnings.join('; '));
  db.setContent(candidate.id, state.text);

  const decision = await askMetered(run, state);
  const answer = decision.answers.find((row) => row.facet === question.facet.id);
  const yesConfidence = answer?.value === 'yes' ? answer.confidence : null;
  const isHit = yesConfidence !== null && yesConfidence >= config.thresholds.review;
  if (isHit) tally.hits.push({ candidate, confidence: yesConfidence });
}

/**
 * Asks the refresh question about one read candidate. Its calls become one `usage` row, stored even
 * when the call then fails, as they were paid for.
 */
async function askMetered(run: RefreshRun, state: FileState) {
  const { db, question, model, tally, job } = run;
  const meter = callMeter(tally, model);
  const ask = () => decide({ state, onTokens: meter.onTokens }, [question.facet], model, db);
  try {
    return await run.modelLimit(ask);
  } finally {
    const usageExtra = { job_id: job.id ?? null, files: 1 };
    if (meter.calls > 0) db.recordUsage(usageRecord('refresh', model, meter.tokens, usageExtra));
  }
}

/** Stores the hits as review items, skipping files that gained the tag or a review meanwhile. */
function storeHits({ db, question }: RefreshSetup, hits: Hit[]): number {
  const hitIds = hits.map(({ candidate }) => candidate.id);
  return db.transaction(() => {
    const settledMeanwhile = db.refreshExcluded(question.scope, hitIds);
    let addedCount = 0;
    for (const { candidate, confidence } of hits) {
      if (settledMeanwhile.has(candidate.id)) continue;
      const review = { file_id: candidate.id, kind: 'suggest' as const, tag: question.scope.tag };
      if (db.addReview({ ...review, confidence, reason: refreshReason(candidate) })) addedCount++;
    }
    return addedCount;
  });
}
