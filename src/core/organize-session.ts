/**
 * The bookkeeping of one organize run. Its files share a `Session`: what they produce waits in the
 * `Tally` until the whole run is done, and only the rows a cancelled run may keep are committed as
 * it goes.
 */
import type { UsageFeature } from '../tool-map.ts';
import pLimit from 'p-limit';
import pkg from '../../package.json' with { type: 'json' };
import type { PricedModel, TokenUsage } from '../ai/pricing.ts';
import { modelTarget, type ModelTarget, type ResolvedChatModel } from '../ai/providers.ts';
import type { Facet, FileRow, FileState, Plan, TagOp } from '../types.ts';
import { type Config, errorMessage, UserError } from './config.ts';
import type { Db, UsageRecord } from './db.ts';
import type { TagChange } from './organize-plan.ts';
import { type Models, refusedPathTest } from './organize-setup.ts';
import { proposePlan } from './plans.ts';
import { addToTally, cacheRecord, usageRecord } from './usage.ts';

const LOW_CONFIDENCE_REASON = 'Not sure enough to apply';
/** Rows between commits of what a run stores as it goes, as each commit waits for the disk. */
const MAX_PENDING_ROWS = 64;

/** The part of a file a run works with. */
export type FileRef = Pick<FileRow, 'id' | 'path'>;

/** Which file this is, and which version of it: what is known before reading it. */
export interface FileIdentity {
  row: FileRef;
  /** The `contentStamp` the plan's op carries, so applying refuses a file changed since. */
  stamp: string;
  extract_key: string;
}

/** What planning needs of a file, whether it was just read or comes from its last result. */
export interface FileFacts extends FileIdentity {
  hash: string;
  state_hash: string;
  mime: string;
  metadata: FileState['metadata'];
}

/** What a run works with. */
export interface RunSetup {
  db: Db;
  config: Config;
  facets: Facet[];
  models: Models;
  /** The `[ner]` model, which reads proper names. Without it, a run reads none. */
  ner?: ResolvedChatModel;
}

/** What a run has gathered so far, shared by every file. */
interface Tally {
  done: number;
  failed: number;
  tokens: number;
  cost: number | null;
  /** Files that cost no model call: every answer was cached, shared or reused. */
  cached: number;
  warnings: string[];
  ops: TagOp[];
  /**
   * Kept until the end, so a cancelled run leaves files `new`. Plain data: a closure here would
   * hold each file's state, text and images, for the whole run.
   */
  results: FileOutcome[];
}

/** One file's result and its doubtful tags, as the end of the run stores them. */
export interface FileOutcome {
  id: number;
  result: Parameters<Db['setFileResult']>[1];
  review: TagChange['review'];
}

/** What the next commit stores: a run keeps these even if it is cancelled. */
export interface PendingRows {
  texts: { id: number; text: string }[];
  links: { id: number; facet: string; key: string }[];
  /** Model calls: they were paid for, so a cancelled run keeps them too. */
  usage: UsageRecord[];
}

/** A run in progress: its setup, plus everything its files share. */
export interface Session extends RunSetup {
  isRefusedPath: (path: string) => boolean;
  modelLimit: ReturnType<typeof pLimit>;
  /** The model whose `state_hash` a file's result records. */
  hashTarget: ModelTarget;
  /** The part of an extraction key that every file of a run shares. */
  extractionSettings: string;
  pending: PendingRows;
  tally: Tally;
  /** The error that stops the run: a rejected key, say. */
  fatal?: UserError;
  /** The job running it, which its usage rows name. */
  jobId: string | null;
}

/** PATH decides which optional tools run, and a new version may read files differently. */
const extractionSettings = (config: Config) =>
  JSON.stringify([
    pkg.version,
    config.pipeline,
    config.budget,
    config.send_images,
    process.env.PATH,
  ]);

const emptyTally = (): Tally => ({
  done: 0,
  failed: 0,
  tokens: 0,
  cost: 0,
  cached: 0,
  warnings: [],
  ops: [],
  results: [],
});

/** A fresh session for a run. The first model sets the `state_hash` that results record. */
export function startSession(setup: RunSetup, jobId: string | null = null): Session {
  const { db, config, models } = setup;
  const [firstModel] = models.values();
  return {
    ...setup,
    isRefusedPath: refusedPathTest(db, config),
    modelLimit: pLimit(config.concurrency),
    hashTarget: firstModel ?? modelTarget(config),
    extractionSettings: extractionSettings(config),
    pending: { texts: [], links: [], usage: [] },
    tally: emptyTally(),
    jobId,
  };
}

/** Stores the pending texts, answer links and usage in one transaction, and empties the queue. */
export function commitPending({ db, pending }: Session): void {
  const { texts, links, usage } = pending;
  pending.texts = [];
  pending.links = [];
  pending.usage = [];
  db.transaction(() => {
    for (const { id, text } of texts) db.setContent(id, text);
    for (const { id, facet, key } of links) db.linkAnswer(id, facet, key);
    for (const row of usage) db.recordUsage(row);
  });
}

/** Commits once enough rows wait, so a long run keeps what it has paid for. */
export function commitIfFull(session: Session): void {
  const { texts, links, usage } = session.pending;
  if (texts.length + links.length + usage.length >= MAX_PENDING_ROWS) commitPending(session);
}

/** Counts a model call's tokens and cost. One call with no known price makes the total unknown. */
export function addUsage(tally: Tally, tokens: TokenUsage, model: PricedModel): void {
  addToTally(tally, tokens, model);
}

/** Queues one file's calls to one model as a `usage` row, which the next commit stores. */
export function queueUsage(
  session: Session,
  feature: UsageFeature,
  model: PricedModel,
  tokens: TokenUsage,
): void {
  const row = usageRecord(feature, model, tokens, { job_id: session.jobId, files: 1 });
  session.pending.usage.push(row);
}

/** Queues the row counting the files that cost nothing, if there were any. */
export function queueCacheHits(session: Session): void {
  const { tally, hashTarget, jobId } = session;
  if (tally.cached > 0) session.pending.usage.push(cacheRecord(hashTarget, tally.cached, jobId));
}

/** Marks a file failed, now, with a warning for the job. The run goes on. */
export function failFile({ db, tally }: Session, row: FileRef, reason: string): void {
  tally.failed++;
  tally.warnings.push(`${row.path}: ${reason}`);
  db.setFileResult(row.id, { status: 'failed', error: reason });
}

/** A `UserError`, such as a rejected key, stops the run. Any other error fails only this file. */
export function recordFailure(session: Session, row: FileRef, error: unknown): void {
  if (error instanceof UserError) {
    session.fatal ??= error;
    return;
  }
  failFile(session, row, errorMessage(error));
}

function storeOutcome(db: Db, { id, result, review }: FileOutcome): void {
  db.setFileResult(id, result);
  for (const { tag, confidence } of review) {
    const item = { file_id: id, kind: 'suggest', tag, confidence } as const;
    db.addReview({ ...item, reason: LOW_CONFIDENCE_REASON });
  }
}

/** Step 6: stores every file's result and the plan, in one transaction. */
export function storeRun({ db, tally }: Session, title: string): Plan {
  return db.transaction(() => {
    for (const outcome of tally.results) storeOutcome(db, outcome);
    return proposePlan(db, title, 'organize', tally.ops);
  });
}
