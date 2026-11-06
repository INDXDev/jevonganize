/**
 * The organize flow: steps 1 to 6 of docs/architecture.md. It applies nothing.
 *
 * A facet is a typed question about a file. For each file the run reads it, asks its facets, and
 * turns the answers into a proposed change: tags to add, tags to drop, and doubtful tags for a
 * person to review. All the changes become one plan, which a person applies later.
 *
 * Files run in parallel and share a `Session`. What they produce waits in its `Tally` until the
 * whole run is done, so a cancelled run leaves only the stored model answers behind.
 */
import { lstat } from 'node:fs/promises';
import { sep } from 'node:path';
import pLimit from 'p-limit';
import { answerKey, decide, stateHash } from '../ai/decide.ts';
import { estimateCost } from '../ai/pricing.ts';
import {
  modelTarget,
  type ModelTarget,
  resolveModel,
  type ResolvedModel,
} from '../ai/providers.ts';
import { extractFile, isFailed } from '../extract/index.ts';
import type { Answer, Facet, FileQuery, FileRow, FileState, Tag, TagOp } from '../types.ts';
import { type Config, errorMessage, UserError } from './config.ts';
import { contentHash } from './content-hash.ts';
import type { Db, MirrorTag } from './db.ts';
import { derive, resolve } from './facet-answers.ts';
import {
  appliesTo,
  isEnabled,
  loadFacets,
  tagFacet,
  toQuestions,
  withVocabulary,
} from './facets.ts';
import { contentStamp, type JobRun, proposePlan, statFields } from './plans.ts';
import { exclusions } from './exclusions.ts';

const LOW_CONFIDENCE_REASON = 'Not sure enough to apply';

/** What to organize. */
export interface OrganizeInput {
  query: FileQuery;
  /** Facet ids or packs, replacing the enabled set for this run. */
  facets?: string[];
}

/** Models by profile, and `undefined` for the default. */
export type Models = Map<string | undefined, ResolvedModel>;

/** True when a facet puts a question to a model. */
export const asksModel = (facet: Facet) => Object.keys(toQuestions(facet)).length > 0;

/** The facets of a run, with active vocabulary merged in. */
export async function facetsForRun(db: Db, config: Config, ids?: string[]): Promise<Facet[]> {
  const all = await loadFacets(config);
  for (const id of ids ?? []) {
    if (!all.some((facet) => facet.id === id || facet.pack === id)) {
      throw new UserError(`There is no facet or pack named "${id}"`);
    }
  }
  const chosen = ids
    ? all.filter((facet) => ids.includes(facet.id) || ids.includes(facet.pack))
    : all.filter((facet) => isEnabled(facet, config));
  return withVocabulary(chosen, db);
}

/** Builds every model a run needs, so a missing key refuses before the first byte is sent. */
export async function modelsForRun(config: Config, facets: Facet[]): Promise<Models> {
  const models: Models = new Map();
  for (const { profile } of facets.filter(asksModel)) {
    if (!models.has(profile)) models.set(profile, await resolveModel(config, profile));
  }
  return models;
}

/**
 * True for a path that must not be read: a secret, excluded, or in no library. The scan already
 * skips these, but a rule may be newer than the row, and a row may name a renamed file.
 */
export function refusedPathTest(db: Db, config: Config): (path: string) => boolean {
  const roots = db
    .listLibraries()
    .map(({ path }) => ({ path, excluded: exclusions(config, path) }));
  return (path) => {
    const root = roots.find((library) => path.startsWith(library.path + sep));
    return !root || root.excluded(path, false);
  };
}

/** What a run works with. */
export interface RunSetup {
  db: Db;
  config: Config;
  facets: Facet[];
  models: Models;
}

type FileChange = ReturnType<typeof planChange>;

/** What a run has gathered so far, shared by every file. */
interface Tally {
  done: number;
  failed: number;
  tokens: number;
  cost: number | null;
  warnings: string[];
  ops: TagOp[];
  /**
   * Kept until the end, so a cancelled run leaves files `new`, and only answers stay. Plain data:
   * a closure here would hold each file's state, text and images, for the whole run.
   */
  results: {
    id: number;
    result: Parameters<Db['setFileResult']>[1];
    review: FileChange['review'];
  }[];
}

interface Session extends RunSetup {
  isRefusedPath: (path: string) => boolean;
  modelLimit: ReturnType<typeof pLimit>;
  hashTarget: ModelTarget;
  tally: Tally;
}

function addUsage(tally: Tally, used: number, model: ResolvedModel): void {
  tally.tokens += used;
  const price = estimateCost(used, model);
  tally.cost = tally.cost === null || price === null ? null : tally.cost + price;
}

function failFile({ db, tally }: Session, row: FileRow, reason: string): void {
  tally.failed++;
  tally.warnings.push(`${row.path}: ${reason}`);
  db.setFileResult(row.id, { status: 'failed', error: reason });
}

/** Asks each facet's model, under the shared limit, and links the file to its answers. */
async function askModels(session: Session, id: number, state: FileState, facets: Facet[]) {
  const { db, models, modelLimit, tally } = session;
  const answers: Answer[] = [];
  const warnings: string[] = [];
  for (const [profile, model] of models) {
    const group = facets.filter((facet) => asksModel(facet) && facet.profile === profile);
    if (group.length === 0) continue;
    const onTokens = (tokens: number) => addUsage(tally, tokens, model);
    const result = await modelLimit(() => decide({ state, onTokens }, group, model, db));
    answers.push(...result.answers);
    warnings.push(...result.warnings);
    const hash = stateHash(state, model);
    for (const facet of group) db.linkAnswer(id, facet.id, answerKey(model, facet, hash));
  }
  return { answers, warnings };
}

/** The tags this run may drop or replace on a file. */
function replaceableTags(mirror: MirrorTag[], facets: Facet[], answers: Answer[]): Tag[] {
  // A refusal says nothing about a tag, so it stays as if this facet was not part of the run.
  const refused = new Set(answers.filter((answer) => answer.refused).map(({ facet }) => facet));
  const answered = new Set(facets.map((facet) => facet.id).filter((name) => !refused.has(name)));
  // A tag the app wrote may follow a new answer. A person's tag is never touched.
  return mirror.filter((row) => row.ai && answered.has(tagFacet(row.tag))).map((row) => row.tag);
}

/** Steps 3 and 5 for one file: what to add, what to drop, and what a person should look at. */
function planChange(
  { db, config }: Pick<RunSetup, 'db' | 'config'>,
  id: number,
  facets: Facet[],
  found: { answers: Answer[]; derived: Tag[] },
) {
  const { answers, derived } = found;
  const mirror = db.fileTags(id);
  const replaceable = replaceableTags(mirror, facets, answers);
  const keptTags = mirror.map((row) => row.tag).filter((tag) => !replaceable.includes(tag));
  const rejected = db.rejectedTags(id);
  const tags = { existing: keptTags, rejected, derived };
  const { apply, review } = resolve(answers, facets, config, tags);
  const wanted = new Set([...apply, ...review.map((item) => item.tag)]);
  const remove = replaceable.filter((tag) => !wanted.has(tag));
  // `resolve` left room for `keptTags` only. What stays of the replaceable tags counts as well.
  const staying = keptTags.length + replaceable.length - remove.length;
  const freeSlots = Math.max(config.max_tags - staying, 0);
  return {
    add: apply.filter((tag) => !replaceable.includes(tag)).slice(0, freeSlots),
    remove,
    review: review.filter((item) => !replaceable.includes(item.tag)),
  };
}

/** Steps 3 to 5 for a file that was read. Its op and result wait in the tally. */
async function planFile(
  session: Session,
  row: FileRow,
  state: FileState & { mime: string },
  { stamp, hash }: { stamp: string; hash: string },
): Promise<void> {
  const { config, facets, tally } = session;
  const applicable = facets.filter((facet) => appliesTo(facet, state.mime));
  const { answers, warnings } = await askModels(session, row.id, state, applicable);
  tally.warnings.push(...warnings.map((warning) => `${row.path}: ${warning}`));

  const derived = applicable.flatMap((facet) => derive(facet, state, config) ?? []);
  const { add, remove, review } = planChange(session, row.id, applicable, { answers, derived });
  tally.ops.push({ file_id: row.id, add, remove, stamp });
  const { mime, metadata } = state;
  const state_hash = stateHash(state, session.hashTarget);
  const result = { status: 'organized' as const, hash, state_hash, mime, metadata };
  tally.results.push({ id: row.id, result, review });
}

/** Steps 1 to 5 for one file. It stores answers and text, and leaves the rest in the tally. */
async function organizeOne(session: Session, row: FileRow): Promise<void> {
  const { db, config, tally } = session;
  if (session.isRefusedPath(row.path)) {
    tally.warnings.push(`Skipped ${row.path}: excluded`);
    return;
  }
  const info = await lstat(row.path, { bigint: true });
  if (!info.isFile()) return failFile(session, row, 'not a regular file');
  const stamp = contentStamp(statFields(info));
  const state = await extractFile(row.path, config);
  if (isFailed(state)) return failFile(session, row, state.warnings.join('; '));
  const hash = await contentHash(row.path);
  db.setContent(row.id, state.text);
  await planFile(session, row, state, { stamp, hash });
}

/** Step 6: stores every file's result and the plan, in one transaction. */
function storeRun({ db, tally }: Session, title: string) {
  return db.transaction(() => {
    for (const { id, result, review } of tally.results) {
      db.setFileResult(id, result);
      for (const { tag, confidence } of review) {
        const item = { file_id: id, kind: 'suggest', tag, confidence } as const;
        db.addReview({ ...item, reason: LOW_CONFIDENCE_REASON });
      }
    }
    return proposePlan(db, title, 'organize', tally.ops);
  });
}

const emptyTally = (): Tally => ({
  done: 0,
  failed: 0,
  tokens: 0,
  cost: 0,
  warnings: [],
  ops: [],
  results: [],
});

function startSession(setup: RunSetup): Session {
  const { db, config, models } = setup;
  const [firstModel] = models.values();
  return {
    ...setup,
    isRefusedPath: refusedPathTest(db, config),
    modelLimit: pLimit(config.concurrency),
    hashTarget: firstModel ?? modelTarget(config),
    tally: emptyTally(),
  };
}

/** Runs steps 1 to 6 and stores a plan. Returns its id. A rejected key stops it, others fail a file. */
export async function organizeFiles(
  setup: RunSetup,
  input: OrganizeInput,
  run: JobRun,
): Promise<string> {
  const { db, config } = setup;
  const { files } = db.searchFiles(input.query);
  const session = startSession(setup);
  const { tally } = session;
  // Twice the model limit, so extraction keeps ahead without holding every state in memory.
  const fileLimit = pLimit(config.concurrency * 2);
  let fatal: UserError | undefined;
  const organizeRow = async (row: FileRow) => {
    if (run.signal.aborted || fatal) return;
    run.update({ current: row.path });
    try {
      await organizeOne(session, row);
    } catch (error) {
      if (error instanceof UserError) fatal ??= error;
      else failFile(session, row, errorMessage(error));
    }
    run.update({ done: ++tally.done, tokens: tally.tokens, cost_usd: tally.cost });
  };

  run.update({ total: files.length });
  await Promise.all(files.map((row) => fileLimit(() => organizeRow(row))));
  if (fatal) throw fatal;
  run.signal.throwIfAborted();

  const plan = storeRun(session, `organize ${input.query.folder ?? 'all files'}`);
  run.update({ plan_id: plan.id, failed: tally.failed, warnings: tally.warnings });
  return plan.id;
}
