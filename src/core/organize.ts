/** The organize flow: steps 1 to 6 of docs/architecture.md. It applies nothing. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { sep } from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import pLimit from 'p-limit';
import { answerKey, cachedAnswer, decide, stateHash } from '../ai/decide.ts';
import { estimateCost } from '../ai/pricing.ts';
import {
  modelTarget,
  type ModelTarget,
  resolveModel,
  type ResolvedModel,
} from '../ai/providers.ts';
import { extractFile, isFailed } from '../extract/index.ts';
import type {
  Answer,
  Estimate,
  Facet,
  FileQuery,
  FileRow,
  FileState,
  Tag,
  TagOp,
} from '../types.ts';
import { type Config, UserError } from './config.ts';
import type { Db } from './db.ts';
import {
  appliesTo,
  derive,
  isEnabled,
  loadFacets,
  resolve,
  tagFacet,
  toQuestions,
  withVocabulary,
} from './facets.ts';
import { contentStamp, type JobRun, proposePlan } from './plans.ts';
import { exclusions } from './scan.ts';

const WHOLE_FILE_BYTES = 64 * 2 ** 20;
const WINDOW_BYTES = 2 ** 20;
const CHARS_PER_TOKEN = 4;
/** shortcut: a flat guess per image, measure real bills if estimates drift. */
const IMAGE_TOKENS = 800;
const ESTIMATE_BATCH = 256;

/** What to organize. */
export interface OrganizeInput {
  query: FileQuery;
  /** Facet ids or packs, replacing the enabled set for this run. */
  facets?: string[];
}

/** Models by profile, and `undefined` for the default. */
export type Models = Map<string | undefined, ResolvedModel>;

const asks = (facet: Facet) => Object.keys(toQuestions(facet)).length > 0;

/** The facets of a run, with active vocabulary merged in. */
export async function runFacets(db: Db, config: Config, ids?: string[]): Promise<Facet[]> {
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
export async function runModels(config: Config, facets: Facet[]): Promise<Models> {
  const models: Models = new Map();
  for (const { profile } of facets.filter(asks)) {
    if (!models.has(profile)) models.set(profile, await resolveModel(config, profile));
  }
  return models;
}

/**
 * True for a path that must not be read: a secret, excluded, or in no library. The scan already
 * skips these, but a rule may be newer than the row, and a row may name a renamed file.
 */
export function refusedPaths(db: Db, config: Config): (path: string) => boolean {
  const roots = db
    .listLibraries()
    .map(({ path }) => ({ path, excluded: exclusions(config, path) }));
  return (path) => {
    const root = roots.find((library) => path.startsWith(library.path + sep));
    return !root || root.excluded(path, false);
  };
}

/** See docs/storage.md: the whole file, or for a large one its size and three windows. */
async function contentHash(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const { size } = await handle.stat();
    const hash = createHash('sha256');
    if (size <= WHOLE_FILE_BYTES) {
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        hash.update(chunk as Uint8Array);
      }
      return `f1:${hash.digest('hex')}`;
    }
    hash.update(String(size));
    for (const position of [0, Math.floor(size / 2), size - WINDOW_BYTES]) {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(WINDOW_BYTES),
        0,
        WINDOW_BYTES,
        position,
      );
      hash.update(buffer.subarray(0, bytesRead));
    }
    return `p1:${hash.digest('hex')}`;
  } finally {
    await handle.close();
  }
}

/** Asks each facet's model, under the shared limit, and links the file to its answers. */
async function askModels(
  db: Db,
  id: number,
  state: FileState,
  facets: Facet[],
  models: Models,
  limit: ReturnType<typeof pLimit>,
  pay: (tokens: number, model: ResolvedModel) => void,
) {
  const answers: Answer[] = [];
  const warnings: string[] = [];
  for (const [profile, model] of models) {
    const group = facets.filter((facet) => asks(facet) && facet.profile === profile);
    if (group.length === 0) continue;
    const onTokens = (tokens: number) => pay(tokens, model);
    const result = await limit(() => decide({ state }, group, model, db, onTokens));
    answers.push(...result.answers);
    warnings.push(...result.warnings);
    const hash = stateHash(state, model);
    for (const facet of group) db.linkAnswer(id, facet.id, answerKey(model, facet, hash));
  }
  return { answers, warnings };
}

/** Steps 3 and 5 for one file: what to add, what to drop, and what a person should look at. */
function plannedChange(
  db: Db,
  id: number,
  answers: Answer[],
  facets: Facet[],
  derived: Tag[],
  config: Config,
) {
  const mirror = db.fileTags(id);
  const asked = new Set(facets.map((facet) => facet.id));
  // A refusal says nothing about a tag, so it stays as if this facet was not part of the run.
  for (const answer of answers) if (answer.refused) asked.delete(answer.facet);
  // A tag the app wrote may follow a new answer. A person's tag is never touched.
  const replaceable = mirror
    .filter((row) => row.ai && asked.has(tagFacet(row.tag)))
    .map((row) => row.tag);
  const fixed = mirror.map((row) => row.tag).filter((tag) => !replaceable.includes(tag));
  const rejected = db.rejectedTags(id);
  const { apply, review } = resolve(answers, facets, config, fixed, rejected, derived);
  const wanted = new Set([...apply, ...review.map((item) => item.tag)]);
  const remove = replaceable.filter((tag) => !wanted.has(tag));
  // `resolve` left room for `fixed` only. What stays of the replaceable tags counts as well.
  const room = Math.max(config.max_tags - fixed.length - replaceable.length + remove.length, 0);
  return {
    add: apply.filter((tag) => !replaceable.includes(tag)).slice(0, room),
    remove,
    review: review.filter((item) => !replaceable.includes(item.tag)),
  };
}

/** Runs steps 1 to 6 and stores a plan. Returns its id. A rejected key stops it, others fail a file. */
export async function organizeFiles(
  db: Db,
  config: Config,
  input: OrganizeInput,
  facets: Facet[],
  models: Models,
  run: JobRun,
): Promise<string> {
  const { files } = db.searchFiles(input.query);
  const refused = refusedPaths(db, config);
  const modelLimit = pLimit(config.concurrency);
  // Twice the model limit, so extraction keeps ahead without holding every state in memory.
  const fileLimit = pLimit(config.concurrency * 2);
  const ops: TagOp[] = [];
  const warnings: string[] = [];
  // Kept until the end, so a cancelled run leaves files `new`, and only answers stay. Plain data:
  // a closure here would hold each file's state, text and images, for the whole run.
  const results: {
    id: number;
    result: Parameters<Db['setFileResult']>[1];
    review: ReturnType<typeof plannedChange>['review'];
  }[] = [];
  const [firstModel] = models.values();
  const hashTarget = firstModel ?? modelTarget(config);
  let done = 0;
  let failed = 0;
  let tokens = 0;
  let cost: number | null = 0;
  let fatal: UserError | undefined;

  const pay = (used: number, model: ResolvedModel) => {
    tokens += used;
    const price = estimateCost(used, model);
    cost = cost === null || price === null ? null : cost + price;
  };

  const fail = (row: FileRow, reason: string) => {
    failed++;
    warnings.push(`${row.path}: ${reason}`);
    db.setFileResult(row.id, { status: 'failed', error: reason });
  };

  async function organizeOne(row: FileRow): Promise<void> {
    if (refused(row.path)) {
      warnings.push(`Skipped ${row.path}: excluded`);
      return;
    }
    const info = await lstat(row.path, { bigint: true });
    if (!info.isFile()) return fail(row, 'not a regular file');
    const stamp = contentStamp({
      ino: String(info.ino),
      size: Number(info.size),
      mtime_ns: String(info.mtimeNs),
    });
    const state = await extractFile(row.path, config);
    if (isFailed(state)) return fail(row, state.warnings.join('; '));
    const hash = await contentHash(row.path);
    db.setContent(row.id, state.text);

    const applicable = facets.filter((facet) => appliesTo(facet, state.mime));
    const asked = await askModels(db, row.id, state, applicable, models, modelLimit, pay);
    warnings.push(...asked.warnings.map((warning) => `${row.path}: ${warning}`));

    const derived = applicable.flatMap((facet) => derive(facet, state, config) ?? []);
    const { add, remove, review } = plannedChange(
      db,
      row.id,
      asked.answers,
      applicable,
      derived,
      config,
    );
    ops.push({ file_id: row.id, add, remove, stamp });
    const { mime, metadata } = state;
    const state_hash = stateHash(state, hashTarget);
    const result = { status: 'organized' as const, hash, state_hash, mime, metadata };
    results.push({ id: row.id, result, review });
  }

  run.update({ total: files.length });
  await Promise.all(
    files.map((row) =>
      fileLimit(async () => {
        if (run.signal.aborted || fatal) return;
        run.update({ current: row.path });
        try {
          await organizeOne(row);
        } catch (error) {
          if (error instanceof UserError) fatal ??= error;
          else fail(row, error instanceof Error ? error.message : String(error));
        }
        run.update({ done: ++done, tokens, cost_usd: cost });
      }),
    ),
  );
  if (fatal) throw fatal;
  run.signal.throwIfAborted();

  const title = `organize ${input.query.folder ?? 'all files'}`;
  const plan = db.transaction(() => {
    for (const { id, result, review } of results) {
      db.setFileResult(id, result);
      for (const { tag, confidence } of review) {
        const reason = 'Not sure enough to apply';
        db.addReview({ file_id: id, kind: 'suggest', tag, confidence, reason });
      }
    }
    return proposePlan(db, title, 'organize', ops);
  });
  run.update({ plan_id: plan.id, failed, warnings });
  return plan.id;
}

/** What a run would cost, from the index alone. Needs no key, and sends nothing. */
export async function estimateRun(db: Db, config: Config, input: OrganizeInput): Promise<Estimate> {
  const facets = await runFacets(db, config, input.facets);
  const asked = facets.filter(asks);
  const files = db.fileStates(input.query);
  const target = modelTarget(config);
  const targets = new Map<string | undefined, ModelTarget>([[undefined, target]]);
  for (const { profile } of asked) {
    if (!targets.has(profile)) targets.set(profile, modelTarget(config, profile));
  }
  const questionChars = new Map(
    asked.map((facet) => [facet.id, JSON.stringify(toQuestions(facet)).length]),
  );

  const keyOf = (facet: Facet, state_hash: string | null) =>
    state_hash ? answerKey(targets.get(facet.profile) ?? target, facet, state_hash) : null;

  let cached = 0;
  let chars = 0;
  let tokens = 0;
  for (let start = 0; start < files.length; start += ESTIMATE_BATCH) {
    const batch = files.slice(start, start + ESTIMATE_BATCH).map((file) => {
      const mime = file.mime ?? 'application/octet-stream';
      const applicable = asked.filter((facet) => appliesTo(facet, mime));
      const wanted = applicable.map((facet) => ({ facet, key: keyOf(facet, file.state_hash) }));
      return { size: file.size, mime, wanted };
    });
    const stored = db.getAnswers(batch.flatMap(({ wanted }) => wanted.flatMap((w) => w.key ?? [])));
    const store = { getAnswer: (key: string) => stored.get(key) };
    for (const { size, mime, wanted } of batch) {
      const missing = wanted.filter(
        ({ facet, key }) => key === null || !cachedAnswer(store, key, facet),
      );
      if (missing.length === 0) {
        cached++;
        continue;
      }
      if (mime.startsWith('image/')) tokens += config.send_images ? IMAGE_TOKENS : 0;
      else chars += Math.min(size, config.budget.text_chars);
      for (const { facet } of missing) chars += questionChars.get(facet.id) ?? 0;
    }
    await yieldToLoop(); // SQLite and hashing are synchronous, so nothing else ran until now
  }
  tokens += Math.ceil(chars / CHARS_PER_TOKEN);
  return {
    files: files.length,
    cached,
    facets: facets.length,
    tokens,
    cost_usd: estimateCost(tokens, target),
    provider: target.provider,
    model: target.modelId,
  };
}
