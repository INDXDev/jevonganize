/**
 * The organize flow: steps 1 to 6 of docs/architecture.md. It applies nothing.
 *
 * A facet is a typed question about a file. For each file the run reads it, asks its facets, and
 * turns the answers into a proposed change: tags to add, tags to drop, and doubtful tags for a
 * person to review. All the changes become one plan, which a person applies later.
 *
 * Files run in parallel and share a `Session` (organize-session.ts), and organize-ask.ts makes
 * their model calls. What they produce waits until the whole run is done, so a cancelled run
 * leaves only the stored model answers, the searchable text and each file's link to its answers.
 *
 * A file is known by four fingerprints. `stamp` is what `lstat` says, so applying refuses a file
 * changed since. `extract_key` adds everything that shapes extraction, so a file whose extraction
 * would repeat itself, with every answer cached, is not read at all. `hash` is its content, and
 * `state_hash` is what the model was sent, which keys its cached answers.
 */
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import pLimit from 'p-limit';
import { extractFile, isFailed } from '../extract/index.ts';
import type { Answer, Facet, FileQuery, Tag } from '../types.ts';
import { contentHash } from './content-hash.ts';
import { derive } from './answer-tags.ts';
import { appliesTo } from './facets.ts';
import { NAME_GATE } from './names.ts';
import { askModels, readProperNames } from './organize-ask.ts';
import { planChange } from './organize-plan.ts';
import {
  commitIfFull,
  commitPending,
  failFile,
  queueCacheHits,
  recordFailure,
  type FileFacts,
  type FileIdentity,
  type FileRef,
  type RunSetup,
  type Session,
  startSession,
  storeRun,
} from './organize-session.ts';
import { reuseLastResult } from './organize-reuse.ts';
import { contentStamp, statFields } from './plan-ops.ts';
import type { JobRun } from './plans.ts';

/** What to organize. */
export interface OrganizeInput {
  query: FileQuery;
  /** Facet ids or packs, replacing the enabled set for this run. */
  facets?: string[];
}

/** What a file was asked, and what came back. */
interface Judgement {
  /** The facets that apply to the file's type. */
  facets: Facet[];
  answers: Answer[];
  /** `entity:` tags the file literally contains. */
  names?: Tag[];
}

/** Runs steps 1 to 6 and stores a plan. Returns its id. A rejected key stops it, others fail a file. */
export async function organizeFiles(
  setup: RunSetup,
  input: OrganizeInput,
  job: JobRun,
): Promise<string> {
  const { db, config } = setup;
  const fileRefs = db.fileRefs(input.query);
  const session = startSession(setup, job.id ?? null);
  // Twice the model limit, so extraction keeps ahead without holding every state in memory.
  const fileLimit = pLimit(config.concurrency * 2);

  job.update({ total: fileRefs.length });
  await Promise.all(fileRefs.map((row) => fileLimit(() => organizeFileInRun(session, row, job))));
  queueCacheHits(session);
  commitPending(session);
  if (session.fatal) throw session.fatal;
  job.signal.throwIfAborted();

  const plan = storeRun(session, `organize ${input.query.folder ?? 'all files'}`);
  const { failed, warnings } = session.tally;
  job.update({ plan_id: plan.id, failed, warnings });
  return plan.id;
}

/** One file's turn in a run. */
async function organizeFileInRun(session: Session, row: FileRef, job: JobRun): Promise<void> {
  if (job.signal.aborted || session.fatal) return;
  job.update({ current: row.path });
  try {
    await organizeFile(session, row);
  } catch (error) {
    recordFailure(session, row, error);
  }
  commitIfFull(session);
  const { tally } = session;
  tally.done++;
  job.update({ done: tally.done, tokens: tally.tokens, cost_usd: tally.cost });
}

/** Steps 1 to 5 for one file. It stores answers and text, and leaves the rest in the tally. */
async function organizeFile(session: Session, row: FileRef): Promise<void> {
  if (session.isRefusedPath(row.path)) {
    session.tally.warnings.push(`Skipped ${row.path}: excluded`);
    return;
  }
  const stats = await lstat(row.path, { bigint: true });
  if (!stats.isFile()) {
    failFile(session, row, 'not a regular file');
    return;
  }
  const stamp = contentStamp(statFields(stats));
  const identity = { row, stamp, extract_key: extractKey(session, row.path, stats.dev, stamp) };
  const lastResult = reuseLastResult(session, identity);
  if (!lastResult) return readAndPlan(session, identity);
  session.tally.cached++;
  recordChange(session, lastResult.facts, lastResult);
}

/**
 * Names one extraction: this file as `lstat` sees it, and all that shapes what is read from it. The
 * path is part of it because the name is in the state. Like a scan, it trusts an unchanged mtime.
 * `ctime` is left out, as writing tags moves it.
 */
function extractKey(session: Session, path: string, device: bigint, stamp: string): string {
  const parts = [session.extractionSettings, path, String(device), stamp];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Steps 1 to 5 for a file that has to be read. */
async function readAndPlan(session: Session, identity: FileIdentity): Promise<void> {
  const { row } = identity;
  const state = await extractFile(row.path, session.config);
  if (isFailed(state)) {
    failFile(session, row, state.warnings.join('; '));
    return;
  }
  const hash = await contentHash(row.path);
  session.pending.texts.push({ id: row.id, text: state.text });
  const { mime, metadata } = state;
  const facets = session.facets.filter((facet) => appliesTo(facet, mime));
  const { answers, warnings, state_hash } = await askModels(session, row.id, state, facets);
  session.tally.warnings.push(...warnings.map((warning) => `${row.path}: ${warning}`));
  const names = await readProperNames(session, row, state, answers);
  const facts = { ...identity, hash, state_hash, mime, metadata };
  recordChange(session, facts, { facets, answers, names });
}

/** The facets and answers that can become tags. The name gate only decides whether names are read. */
const withoutNameGate = ({ facets, answers }: Judgement) => ({
  facets: facets.filter((facet) => facet.id !== NAME_GATE),
  answers: answers.filter((answer) => answer.facet !== NAME_GATE),
});

/** Steps 3 and 5 for a file with its answers. Its op and result wait in the tally until step 6. */
function recordChange(session: Session, facts: FileFacts, judgement: Judgement): void {
  const { config, tally } = session;
  const { row, stamp, extract_key, hash, state_hash, mime, metadata } = facts;
  const tagging = withoutNameGate(judgement);
  const derived = tagging.facets.flatMap((facet) => derive(facet, { metadata }, config) ?? []);
  const planned = planChange(session, row.id, tagging.facets, {
    answers: tagging.answers,
    derived,
  });
  const tagsToAdd = [...new Set([...planned.add, ...(judgement.names ?? [])])];
  tally.ops.push({ file_id: row.id, add: tagsToAdd, remove: planned.remove, stamp });
  const result = { status: 'organized' as const, hash, state_hash, extract_key, mime, metadata };
  tally.results.push({ id: row.id, result, review: planned.review });
}
