/**
 * The organize flow: steps 1 to 6 of docs/architecture.md. It applies nothing.
 *
 * A facet is a typed question about a file. For each file the run reads it, asks its facets, and
 * turns the answers into a proposed change: tags to add, tags to drop, and doubtful tags for a
 * person to review. All the changes become one plan, which a person applies later.
 *
 * Files run in parallel and share a `Session`. What they produce waits in its `Tally` until the
 * whole run is done, so a cancelled run leaves only the stored model answers, the searchable text
 * and each file's link to its answers behind.
 *
 * A file whose extraction would repeat itself, with every answer cached, is not read at all.
 */
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { sep } from 'node:path';
import pLimit from 'p-limit';
import pkg from '../../package.json' with { type: 'json' };
import { answerKey, cachedAnswer, decide, stateHash } from '../ai/decide.ts';
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
import { sharedExclusions } from './exclusions.ts';

const LOW_CONFIDENCE_REASON = 'Not sure enough to apply';
/** Rows between commits of what a run stores as it goes, as each commit waits for the disk. */
const MAX_PENDING_ROWS = 64;

/** The part of a file this module works with. */
type FileRef = Pick<FileRow, 'id' | 'path'>;

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
    .libraryPaths()
    .map((path) => ({ path, excluded: sharedExclusions(config, path) }));
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
   * Kept until the end, so a cancelled run leaves files `new`. Plain data: a closure here would
   * hold each file's state, text and images, for the whole run.
   */
  results: FileOutcome[];
}

/** One file's result and its doubtful tags, as step 6 stores them. */
interface FileOutcome {
  id: number;
  result: Parameters<Db['setFileResult']>[1];
  review: FileChange['review'];
}

/** What the next commit stores: a run keeps these even if it is cancelled. */
interface PendingRows {
  texts: { id: number; text: string }[];
  links: { id: number; facet: string; key: string }[];
}

interface Session extends RunSetup {
  isRefusedPath: (path: string) => boolean;
  modelLimit: ReturnType<typeof pLimit>;
  hashTarget: ModelTarget;
  /** The part of an `extractKey` that every file of a run shares. */
  extractionSettings: string;
  pending: PendingRows;
  tally: Tally;
  /** The error that stops the run: a rejected key, say. */
  fatal?: UserError;
}

function commitPending({ db, pending }: Session): void {
  const { texts, links } = pending;
  pending.texts = [];
  pending.links = [];
  db.transaction(() => {
    for (const { id, text } of texts) db.setContent(id, text);
    for (const { id, facet, key } of links) db.linkAnswer(id, facet, key);
  });
}

/**
 * Names one extraction: this file as `lstat` sees it, and all that shapes what is read from it. The
 * path is part of it because the name is in the state. Like a scan, it trusts an unchanged mtime.
 * `ctime` is left out, as writing tags moves it.
 */
function extractKey({ extractionSettings }: Session, path: string, info: BigIntStats): string {
  const stamp = contentStamp(statFields(info));
  const parts = [extractionSettings, path, String(info.dev), stamp];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function addUsage(tally: Tally, used: number, model: ResolvedModel): void {
  tally.tokens += used;
  const price = estimateCost(used, model);
  tally.cost = tally.cost === null || price === null ? null : tally.cost + price;
}

function failFile({ db, tally }: Session, row: FileRef, reason: string): void {
  tally.failed++;
  tally.warnings.push(`${row.path}: ${reason}`);
  db.setFileResult(row.id, { status: 'failed', error: reason });
}

/** The facets that put a question to this profile's model. */
const askedOf = (facets: Facet[], profile: string | undefined) =>
  facets.filter((facet) => asksModel(facet) && facet.profile === profile);

/** Asks each facet's model, under the shared limit, and links the file to its answers. */
async function askModels(session: Session, id: number, state: FileState, facets: Facet[]) {
  const { db, models, modelLimit, pending, tally } = session;
  const answers: Answer[] = [];
  const warnings: string[] = [];
  let targetHash: string | undefined;
  for (const [profile, model] of models) {
    const group = askedOf(facets, profile);
    if (group.length === 0) continue;
    const onTokens = (tokens: number) => addUsage(tally, tokens, model);
    const result = await modelLimit(() => decide({ state, onTokens }, group, model, db));
    answers.push(...result.answers);
    warnings.push(...result.warnings);
    if (model === session.hashTarget) targetHash = result.state_hash;
    for (const facet of group) {
      const key = answerKey(model, facet, result.state_hash);
      pending.links.push({ id, facet: facet.id, key });
    }
  }
  return { answers, warnings, state_hash: targetHash ?? stateHash(state, session.hashTarget) };
}

/**
 * Every answer these facets have for a state, with the file linked to them, or `undefined` and no
 * links if one is missing.
 */
function reuseAnswers(session: Session, id: number, facets: Facet[], state_hash: string) {
  const { db, models, pending } = session;
  const answers: Answer[] = [];
  const links: PendingRows['links'] = [];
  for (const [profile, model] of models) {
    for (const facet of askedOf(facets, profile)) {
      const key = answerKey(model, facet, state_hash);
      const rows = cachedAnswer(db, key, facet);
      if (!rows) return undefined;
      answers.push(...rows);
      links.push({ id, facet: facet.id, key });
    }
  }
  pending.links.push(...links);
  return answers;
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

/** Which file this is, and which version of it: what is known before reading it. */
interface FileIdentity {
  row: FileRef;
  stamp: string;
  extract_key: string;
}

/** What planning needs of a file, whether it was just read or comes from its last result. */
interface FileFacts extends FileIdentity {
  hash: string;
  state_hash: string;
  mime: string;
  metadata: FileState['metadata'];
}

/** Steps 3 and 5 for a file with its answers. Its op and result wait in the tally. */
function planFile(session: Session, file: FileFacts, applicable: Facet[], answers: Answer[]): void {
  const { config, tally } = session;
  const { row, stamp, extract_key, hash, state_hash, mime, metadata } = file;
  const derived = applicable.flatMap((facet) => derive(facet, { metadata }, config) ?? []);
  const { add, remove, review } = planChange(session, row.id, applicable, { answers, derived });
  tally.ops.push({ file_id: row.id, add, remove, stamp });
  const result = { status: 'organized' as const, hash, state_hash, extract_key, mime, metadata };
  tally.results.push({ id: row.id, result, review });
}

/** The file's last result, if reading it again could only give the same state. */
function lastResult({ db }: Session, identity: FileIdentity): FileFacts | undefined {
  const { id } = identity.row;
  const file = db.fileById(id);
  if (file?.extract_key !== identity.extract_key || file.status !== 'organized') return undefined;
  const { hash, state_hash, mime, metadata } = file;
  if (!hash || !state_hash || !mime || !metadata) return undefined;
  if (db.getContent(id) === undefined) return undefined;
  return { ...identity, hash, state_hash, mime, metadata: JSON.parse(metadata) };
}

/** Plans a file from its last result. False if it has to be read or asked about again. */
function planFromLastResult(session: Session, identity: FileIdentity): boolean {
  const file = lastResult(session, identity);
  if (!file) return false;
  const applicable = session.facets.filter((facet) => appliesTo(facet, file.mime));
  const answers = reuseAnswers(session, file.row.id, applicable, file.state_hash);
  if (!answers) return false;
  planFile(session, file, applicable, answers);
  return true;
}

/** Steps 1 to 5 for a file that has to be read. */
async function readAndPlan(session: Session, identity: FileIdentity): Promise<void> {
  const { config, facets, pending, tally } = session;
  const { row } = identity;
  const state = await extractFile(row.path, config);
  if (isFailed(state)) return failFile(session, row, state.warnings.join('; '));
  const hash = await contentHash(row.path);
  pending.texts.push({ id: row.id, text: state.text });
  const { mime, metadata } = state;
  const applicable = facets.filter((facet) => appliesTo(facet, mime));
  const { answers, warnings, state_hash } = await askModels(session, row.id, state, applicable);
  tally.warnings.push(...warnings.map((warning) => `${row.path}: ${warning}`));
  planFile(session, { ...identity, hash, state_hash, mime, metadata }, applicable, answers);
}

/** Steps 1 to 5 for one file. It stores answers and text, and leaves the rest in the tally. */
async function organizeOne(session: Session, row: FileRef): Promise<void> {
  if (session.isRefusedPath(row.path)) {
    session.tally.warnings.push(`Skipped ${row.path}: excluded`);
    return;
  }
  const info = await lstat(row.path, { bigint: true });
  if (!info.isFile()) return failFile(session, row, 'not a regular file');
  const stamp = contentStamp(statFields(info));
  const identity = { row, stamp, extract_key: extractKey(session, row.path, info) };
  if (!planFromLastResult(session, identity)) await readAndPlan(session, identity);
}

/** Step 6: stores every file's result and the plan, in one transaction. */
function storeRun({ db, tally }: Session, title: string) {
  return db.transaction(() => {
    for (const outcome of tally.results) storeOutcome(db, outcome);
    return proposePlan(db, title, 'organize', tally.ops);
  });
}

function storeOutcome(db: Db, { id, result, review }: FileOutcome): void {
  db.setFileResult(id, result);
  for (const { tag, confidence } of review) {
    const item = { file_id: id, kind: 'suggest', tag, confidence } as const;
    db.addReview({ ...item, reason: LOW_CONFIDENCE_REASON });
  }
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

/** PATH decides which optional tools run, and a new version may read files differently. */
const extractionSettings = (config: Config) =>
  JSON.stringify([
    pkg.version,
    config.pipeline,
    config.budget,
    config.send_images,
    process.env.PATH,
  ]);

function startSession(setup: RunSetup): Session {
  const { db, config, models } = setup;
  const [firstModel] = models.values();
  return {
    ...setup,
    isRefusedPath: refusedPathTest(db, config),
    modelLimit: pLimit(config.concurrency),
    hashTarget: firstModel ?? modelTarget(config),
    extractionSettings: extractionSettings(config),
    pending: { texts: [], links: [] },
    tally: emptyTally(),
  };
}

/** One file's turn in a run. A `UserError` stops the run, and any other error fails this file. */
async function organizeRow(session: Session, row: FileRef, run: JobRun): Promise<void> {
  if (run.signal.aborted || session.fatal) return;
  const { pending, tally } = session;
  run.update({ current: row.path });
  try {
    await organizeOne(session, row);
  } catch (error) {
    if (error instanceof UserError) session.fatal ??= error;
    else failFile(session, row, errorMessage(error));
  }
  if (pending.texts.length + pending.links.length >= MAX_PENDING_ROWS) commitPending(session);
  run.update({ done: ++tally.done, tokens: tally.tokens, cost_usd: tally.cost });
}

/** Runs steps 1 to 6 and stores a plan. Returns its id. A rejected key stops it, others fail a file. */
export async function organizeFiles(
  setup: RunSetup,
  input: OrganizeInput,
  run: JobRun,
): Promise<string> {
  const { db, config } = setup;
  const files = db.fileRefs(input.query);
  const session = startSession(setup);
  const { tally } = session;
  // Twice the model limit, so extraction keeps ahead without holding every state in memory.
  const fileLimit = pLimit(config.concurrency * 2);

  run.update({ total: files.length });
  await Promise.all(files.map((row) => fileLimit(() => organizeRow(session, row, run))));
  commitPending(session);
  if (session.fatal) throw session.fatal;
  run.signal.throwIfAborted();

  const plan = storeRun(session, `organize ${input.query.folder ?? 'all files'}`);
  run.update({ plan_id: plan.id, failed: tally.failed, warnings: tally.warnings });
  return plan.id;
}
