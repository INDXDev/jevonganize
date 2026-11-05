/** The tool table: every operation, defined once. The CLI, HTTP, chat and MCP all call it. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'smol-toml';
import { z } from 'zod';
import { resolveChatModel, resolveModel } from '../ai/providers.ts';
import { suggest } from '../ai/suggest.ts';
import { extractFile, isFailed, optionalTools } from '../extract/index.ts';
import { thumbnail } from '../extract/thumbs.ts';
import type {
  Check,
  CleanupReport,
  Facet,
  FacetInfo,
  Job,
  Library,
  Plan,
  ProviderName,
  ReviewItem,
  ServerEvent,
  TagCount,
  ToolMap,
  ToolName,
} from '../types.ts';
import {
  type Config,
  configJsonSchema,
  ifExists,
  indexedPath,
  isTable,
  loadConfig,
  parseToml,
  parseWith,
  paths,
  readRegularFile,
  saveConfig,
  UserError,
  writeFileAtomic,
} from './config.ts';
import { KEY_ENV, keySource, setApiKey } from './credentials.ts';
import { type Db, openDb } from './db.ts';
import { facetSchema, isEnabled, loadFacets, tagFacet } from './facets.ts';
import { estimateRun, organizeFiles, refusedPaths, runFacets, runModels } from './organize.ts';
import {
  applyPlan,
  claimPlan,
  type JobRun,
  proposeChanges,
  proposeRename,
  proposeReviews,
  recoverPlans,
  undoPlan,
} from './plans.ts';
import { scanLibrary, secretRoot } from './scan.ts';
import { supported } from './tags.ts';
import { watchLibrary } from './watch.ts';

/** What every tool runs with. */
export interface Context {
  db: Db;
  config: Config;
  /** Sets `Plan.source`, and gates approval. */
  caller: 'cli' | 'ui' | 'chat' | 'mcp';
  emit(event: ServerEvent): void;
  /** MCP's `--allow-apply`: the person opted out of the gate for this server. */
  approved?: boolean;
}

/** One operation. See the table in docs/contracts.md. */
export interface Tool<I, O> {
  description: string;
  input: z.ZodType<I>;
  run(input: I, ctx: Context): Promise<O>;
  /** Changes tags, config or stored state. */
  writes: boolean;
  /** Offered to chat and MCP. `false` is a security boundary. */
  agent: boolean;
  /** A person must approve it when a model calls it. */
  approval?: boolean;
}

type ToolTable = { [K in ToolName]: Tool<ToolMap[K][0], ToolMap[K][1]> };

const DEFAULT_ROWS = 50;
const MODEL_MAX_ROWS = 200;
/** A refresh rewrites every file's weight, so a stream of watch events shares one. */
const REFRESH_MS = 5000;
const KEPT_JOBS = 20;
const OVER_BROAD_SHARE = 0.5;
const OVER_BROAD_MIN_FILES = 10;
const VOCABULARY_SHOWN = 500;

const nothing = z.strictObject({}) as unknown as z.ZodType<Record<string, never>>;
const tag = z.string().min(1);
const fileId = z.int().positive();
const planId = z.strictObject({ id: z.string().min(1) });

const fileQuery = z.strictObject({
  text: z.string().optional(),
  folder: z.string().optional(),
  tags: z.array(tag).optional(),
  exclude_tags: z.array(tag).optional(),
  mime: z.string().optional(),
  status: z.enum(['new', 'organized', 'failed']).optional(),
  sort: z.enum(['name', 'modified', 'size', 'relevance']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.int().positive().optional(),
  offset: z.int().nonnegative().optional(),
});

const runInput = z.strictObject({ query: fileQuery, facets: z.array(z.string()).optional() });

const isModel = ({ caller }: Context) => caller === 'chat' || caller === 'mcp';
const planSource = ({ caller }: Context): Plan['source'] =>
  caller === 'chat' || caller === 'mcp' ? caller : 'user';

// Jobs

interface RunningJob {
  job: Job;
  controller: AbortController;
  finished: Promise<Job>;
}

const jobs = new Map<string, RunningJob>();
const snapshot = (job: Job): Job => ({ ...job });
const running = () => [...jobs.values()].filter(({ job }) => job.status === 'running');

function forgetOldJobs(): void {
  const ended = [...jobs.values()].filter(({ job }) => job.status !== 'running');
  for (const { job } of ended.slice(0, -KEPT_JOBS)) jobs.delete(job.id);
}

/** Starts work in the background and returns its `Job`. Progress goes out through `ctx.emit`. */
function startJob(
  kind: Job['kind'],
  ctx: Context,
  work: (run: JobRun) => Promise<void>,
  start: Partial<Job> = {},
): Job {
  const controller = new AbortController();
  const job: Job = {
    id: randomBytes(4).toString('hex'),
    kind,
    status: 'running',
    done: 0,
    total: 0,
    ...start,
  };
  const update = (patch: Partial<Job>) => {
    Object.assign(job, patch);
    ctx.emit({ type: 'job', job: snapshot(job) });
  };
  const finished = Promise.resolve()
    .then(() => work({ signal: controller.signal, update }))
    .then(() => update({ status: controller.signal.aborted ? 'cancelled' : 'done' }))
    .catch((error: unknown) => {
      if (controller.signal.aborted) update({ status: 'cancelled' });
      else update({ status: 'failed', error: (error as Error).message });
    })
    .then(() => {
      update({ current: undefined });
      forgetOldJobs();
      return snapshot(job);
    });
  jobs.set(job.id, { job, controller, finished });
  return snapshot(job);
}

/** Resolves with a job's final state. The CLI waits here, since a tool only starts its job. */
export async function waitForJob(id: string): Promise<Job> {
  const entry = jobs.get(id);
  if (!entry) throw new UserError(`There is no job ${id}`);
  return entry.finished;
}

// Helpers

/** Stamps tags with their facet and weight, then refreshes the numbers similarity reads. */
function refreshTags(db: Db, facets: Facet[]): void {
  db.setTagFacets(facets);
  db.refreshIdf();
}

const emitReviews = (ctx: Context) => ctx.emit({ type: 'reviews', count: ctx.db.stats().reviews });

async function taggable(path: string): Promise<boolean> {
  return supported(path).catch(() => false);
}

async function libraries(db: Db): Promise<Library[]> {
  return Promise.all(
    db.listLibraries().map(async (library) => ({
      ...library,
      taggable: await taggable(library.path),
    })),
  );
}

function requirePlan(db: Db, id: string): Plan {
  const plan = db.getPlan(id);
  if (!plan) throw new UserError(`There is no plan ${id}`);
  return plan;
}

function refuseIfBusy(id: string): void {
  if (running().some(({ job }) => job.plan_id === id && job.kind !== 'organize')) {
    throw new UserError(`Plan ${id} is already being worked on`);
  }
}

/** The file behind an id, if it may be read: indexed, in a library, and not excluded. */
export function servableFile(ctx: Context, id: number) {
  const file = ctx.db.fileById(id);
  return file && !refusedPaths(ctx.db, ctx.config)(file.path) ? file : undefined;
}

/** The cached thumbnail of a file, or null. Decoding happens in the worker pool. */
export async function thumbnailFile(ctx: Context, id: number, size: 256 | 1024) {
  const record = servableFile(ctx, id);
  const row = ctx.db.fileRow(id);
  return record && row ? thumbnail({ ...row, hash: record.hash }, size) : null;
}

/** Ids of the user's own facets. A broken file counts for nothing, as in `loadFacets`. */
async function customFacetIds(): Promise<Set<string>> {
  const names = (await ifExists(readdir(paths.facetsDir()))) ?? [];
  const ids = new Set<string>();
  for (const name of names.filter((file) => file.endsWith('.toml'))) {
    const file = join(paths.facetsDir(), name);
    try {
      const { facet } = parseToml(await readRegularFile(file), file);
      for (const entry of Array.isArray(facet) ? facet : []) {
        if (isTable(entry) && typeof entry.id === 'string') ids.add(entry.id);
      }
    } catch {
      // `loadFacets` already warned about this file.
    }
  }
  return ids;
}

const facetFile = (id: string) => join(paths.facetsDir(), `${id}.toml`);

async function saveFacet(facet: Facet): Promise<Facet> {
  const { pack, ...entry } = facet;
  await writeFileAtomic(facetFile(facet.id), stringify({ pack, title: pack, facet: [entry] }));
  return facet;
}

/** Turns ids on or off, in `[facets]`. A later `disabled` beats a pack that stays enabled. */
async function setEnabled(ids: string[], enabled: boolean, ctx: Context): Promise<void> {
  const known = await loadFacets(ctx.config);
  for (const id of ids) {
    if (!known.some((facet) => facet.id === id || facet.pack === id)) {
      throw new UserError(`There is no facet or pack named "${id}"`);
    }
  }
  const without = (list: string[]) => list.filter((id) => !ids.includes(id));
  const current = ctx.config.facets;
  const facets = {
    enabled: enabled ? [...without(current.enabled), ...ids] : without(current.enabled),
    disabled: enabled ? without(current.disabled) : [...without(current.disabled), ...ids],
  };
  Object.assign(ctx.config, await saveConfig({ facets }));
}

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Same facet, and labels equal but for punctuation, or one extending the other. */
// shortcut: compares every pair, group by facet if tag counts reach the tens of thousands.
function nearDuplicates(counts: TagCount[]): CleanupReport['near_duplicates'] {
  const rows = counts.map((row) => ({
    ...row,
    facet: tagFacet(row.tag),
    squashed: squash(row.tag),
    prefix: `${row.tag}-`,
  }));
  const found: CleanupReport['near_duplicates'] = [];
  rows.forEach((a, index) => {
    for (let next = index + 1; next < rows.length; next++) {
      const b = rows[next]!;
      const near =
        a.squashed === b.squashed || a.tag.startsWith(b.prefix) || b.tag.startsWith(a.prefix);
      if (near && a.facet === b.facet) {
        found.push({ tags: [a.tag, b.tag], files: a.count + b.count });
      }
    }
  });
  return found;
}

function cleanupReport(db: Db): CleanupReport {
  const counts = db.tagCounts();
  const { files } = db.stats();
  return {
    near_duplicates: nearDuplicates(counts),
    single_use: counts.filter(({ count }) => count === 1),
    over_broad:
      files < OVER_BROAD_MIN_FILES
        ? []
        : counts.filter(({ count }) => count / files > OVER_BROAD_SHARE),
  };
}

async function doctor({ db, config }: Context): Promise<Check[]> {
  const { name } = config.provider;
  const source = await keySource(name);
  const local = name === 'compatible' || name === 'chat'; // a local server may want no key
  const checks: Check[] = [
    { name: 'runtime', ok: true, detail: `Node.js ${process.versions.node}` },
    {
      name: 'key',
      ok: source !== null || local,
      detail: source ? `${name} key present (${source})` : `No API key for ${name}`,
    },
  ];
  for (const { path, taggable: ok } of await libraries(db)) {
    const detail = `${path} ${ok ? 'can' : 'cannot'} store tags`;
    checks.push({ name: 'volume', ok, detail });
  }
  for (const [tool, found] of Object.entries(optionalTools())) {
    if (!found) {
      const detail = `${tool} not found: files that need it get less extraction`;
      checks.push({ name: `optional:${tool}`, ok: true, detail });
    }
  }
  return checks;
}

/** Shows a file in the file manager. Never opens it: that could run it. */
function reveal(path: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', ['-R', path]]
      : process.platform === 'win32'
        ? ['explorer', [`/select,${path}`]]
        : ['xdg-open', [dirname(path)]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // no file manager to show it in, and nothing for the caller to do
  child.unref();
}

// Watching

let watched:
  | {
      ctx: Context;
      stops: Map<string, () => Promise<void>>;
      changed: Set<number>;
      timer?: NodeJS.Timeout;
    }
  | undefined;

const watchFailed = (error: unknown) => process.emitWarning(String(error));

/** One refresh and one `files` event for all that changed, so the UI refetches once as well. */
async function refreshWatched(state: NonNullable<typeof watched>): Promise<void> {
  state.timer = undefined;
  const ids = [...state.changed];
  state.changed.clear();
  const facets = await loadFacets(state.ctx.config);
  if (watched !== state) return; // stopped, and the database may be closed
  refreshTags(state.ctx.db, facets);
  state.ctx.emit({ type: 'files', ids });
}

function syncWatchers(): void {
  if (!watched) return;
  const state = watched;
  const { ctx, stops } = state;
  const current = ctx.db.listLibraries().map(({ path }) => path);
  for (const [path, stop] of stops) {
    if (!current.includes(path)) {
      void stop();
      stops.delete(path);
    }
  }
  const onChange = (ids: number[]) => {
    for (const id of ids) state.changed.add(id);
    // Not reset per event, so a stream cannot starve it.
    state.timer ??= setTimeout(() => void refreshWatched(state).catch(watchFailed), REFRESH_MS);
  };
  for (const path of current.filter((library) => !stops.has(library))) {
    stops.set(path, watchLibrary(ctx.db, ctx.config, path, { onChange, onError: watchFailed }));
  }
}

/** Watches every library, including ones added later, until the returned function is called. */
export function watchLibraries(ctx: Context): () => Promise<void> {
  watched = { ctx, stops: new Map(), changed: new Set() };
  syncWatchers();
  return async () => {
    const stops = [...(watched?.stops.values() ?? [])];
    clearTimeout(watched?.timer);
    watched = undefined;
    await Promise.all(stops.map((stop) => stop()));
  };
}

// The table

/** Every operation. `writes`, `agent` and `approval` are the table in docs/contracts.md. */
export const tools: ToolTable = {
  status: {
    description: 'Libraries, counts, jobs, and the provider in use.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { db, config }) => ({
      libraries: await libraries(db),
      ...db.stats(),
      jobs: [...jobs.values()].map(({ job }) => snapshot(job)),
      provider: config.provider.name,
      model: config.provider.model ?? '',
      has_key: (await keySource(config.provider.name)) !== null,
      keys: (
        await Promise.all(
          (Object.keys(KEY_ENV) as ProviderName[]).map(async (name) =>
            (await keySource(name)) === null ? [] : [name],
          ),
        )
      ).flat(),
    }),
  },

  list_libraries: {
    description: 'The folders Jevonganize indexes.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { db }) => libraries(db),
  },

  add_library: {
    description: 'Adds a folder to the index.',
    input: z.strictObject({ path: z.string().min(1) }),
    writes: true,
    agent: false,
    run: async ({ path }, { db, config }) => {
      const root = indexedPath(path);
      if (!(await ifExists(stat(root)))?.isDirectory()) {
        throw new UserError(`${root} is not a folder`);
      }
      // By real path, or a link would carry a secret folder past rules that go by whole path.
      if (secretRoot(config, root)) throw new UserError(`${root} is excluded`);
      db.addLibrary(root);
      syncWatchers();
      const library = db.listLibraries().find((entry) => entry.path === root);
      return { path: root, files: 0, scanned_at: null, ...library, taggable: await taggable(root) };
    },
  },

  remove_library: {
    description: 'Forgets a folder. Its tags stay on the files.',
    input: z.strictObject({ path: z.string().min(1) }),
    writes: true,
    agent: false,
    run: async ({ path }, { db }) => {
      db.removeLibrary(indexedPath(path));
      syncWatchers();
    },
  },

  browse_dirs: {
    description: 'Lists child folders, for the folder picker.',
    input: z.strictObject({ path: z.string().optional() }),
    writes: false,
    agent: false,
    run: async ({ path }) => {
      const dir = resolve(path ?? homedir());
      const entries = await ifExists(readdir(dir, { withFileTypes: true }));
      if (!entries) throw new UserError(`${dir} does not exist`);
      const parent = dirname(dir);
      return {
        path: dir,
        parent: parent === dir ? null : parent,
        dirs: entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => entry.name)
          .toSorted(),
      };
    },
  },

  scan: {
    description: 'Updates the index from the disk. Local and free. Starts a job.',
    input: z.strictObject({ path: z.string().optional() }),
    writes: true,
    agent: true,
    run: async ({ path }, ctx) => {
      const { db, config } = ctx;
      const known = db.listLibraries().map((library) => library.path);
      const roots = path === undefined ? known : [indexedPath(path)];
      const unknown = roots.find((root) => !known.includes(root));
      if (unknown !== undefined) throw new UserError(`${unknown} is not a library`);
      const facets = await loadFacets(config);
      return startJob('scan', ctx, async (run) => {
        const totals = {
          files: 0,
          added: 0,
          changed: 0,
          moved: 0,
          removed: 0,
          restores: 0,
          skipped: 0,
        };
        const warnings: string[] = [];
        const ids: number[] = [];
        for (const root of roots) {
          if (run.signal.aborted) break;
          const before = totals.files;
          const onProgress = ({ done, current }: { done: number; current: string }) =>
            run.update({ done: before + done, total: before + done, current });
          try {
            const result = await scanLibrary(db, config, root, onProgress);
            for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
              totals[key] += result[key];
            }
            warnings.push(...result.warnings);
            ids.push(...result.ids);
          } catch (error) {
            // One unplugged drive must not stop the others. Asked for by name, it is the answer.
            if (!(error instanceof UserError) || path !== undefined) throw error;
            warnings.push(error.message);
          }
        }
        refreshTags(db, facets);
        run.update({ done: totals.files, total: totals.files, scan: totals, warnings });
        if (ids.length > 0) ctx.emit({ type: 'files', ids });
        if (totals.restores > 0) emitReviews(ctx);
      });
    },
  },

  search_files: {
    description: 'Finds files by text, name, folder, tags and type.',
    input: fileQuery,
    writes: false,
    agent: true,
    run: async (query, ctx) => {
      const limit = query.limit ?? DEFAULT_ROWS;
      const allowed = isModel(ctx) ? Math.min(limit, MODEL_MAX_ROWS) : limit;
      return ctx.db.searchFiles({ ...query, limit: allowed });
    },
  },

  get_file: {
    description: 'Everything known about one file, by id or path.',
    input: z.strictObject({ id: fileId.optional(), path: z.string().optional() }),
    writes: false,
    agent: true,
    run: async ({ id, path }, { db }) => {
      if (id === undefined && path === undefined) throw new UserError('Give an id or a path');
      const found = id ?? db.fileByPath(indexedPath(path ?? ''))?.id;
      const detail = found === undefined ? undefined : db.fileDetail(found);
      if (!detail) {
        const hint = path === undefined ? '' : ` Run: jevonganize scan ${dirname(resolve(path))}`;
        throw new UserError(`${path ?? `File ${id}`} is not in the index.${hint}`);
      }
      return { ...detail, taggable: await taggable(detail.path) };
    },
  },

  similar_files: {
    description: 'Files most like this one, by shared tags.',
    input: z.strictObject({ id: fileId, limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    run: async ({ id, limit }, { db }) => db.similarFiles(id, limit),
  },

  list_tags: {
    description: 'Tags in use with their counts.',
    input: z.strictObject({ folder: z.string().optional(), facet: z.string().optional() }),
    writes: false,
    agent: true,
    run: async (filter, { db }) => db.tagCounts(filter),
  },

  list_facets: {
    description: 'Every facet, and whether it is enabled.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { config }): Promise<FacetInfo[]> => {
      const custom = await customFacetIds();
      const facets = await loadFacets(config);
      return facets.map((facet) => ({
        ...facet,
        enabled: isEnabled(facet, config),
        custom: custom.has(facet.id),
      }));
    },
  },

  save_facet: {
    description: 'Saves a custom facet.',
    input: facetSchema,
    writes: true,
    agent: false,
    run: async (facet) => saveFacet(facet),
  },

  delete_facet: {
    description: 'Deletes a custom facet.',
    input: z.strictObject({ id: z.string().regex(/^[a-z0-9-]+$/) }),
    writes: true,
    agent: false,
    run: async ({ id }) => {
      if (!(await ifExists(stat(facetFile(id)))))
        throw new UserError(`${id} is not a custom facet`);
      await rm(facetFile(id));
    },
  },

  set_enabled: {
    description: 'Turns facets or packs on or off.',
    input: z.strictObject({ ids: z.array(z.string().min(1)), enabled: z.boolean() }),
    writes: true,
    agent: false,
    run: async ({ ids, enabled }, ctx) => setEnabled(ids, enabled, ctx),
  },

  estimate: {
    description: 'What organizing these files would cost. Sends nothing.',
    input: runInput,
    writes: false,
    agent: true,
    run: async (input, { db, config }) => estimateRun(db, config, input),
  },

  organize: {
    description:
      'Classifies files with the model and produces a plan. Writes no tags, but sends file data to the provider and costs money. Starts a job.',
    input: runInput,
    writes: true,
    agent: true,
    approval: true,
    run: async (input, ctx) => {
      const { db, config } = ctx;
      if (running().some(({ job }) => job.kind === 'organize')) {
        throw new UserError('An organize job is already running');
      }
      const facets = await runFacets(db, config, input.facets);
      const models = await runModels(config, facets); // refuses here, before anything is sent
      return startJob('organize', ctx, async (run) => {
        await organizeFiles(db, config, input, facets, models, run);
        emitReviews(ctx);
      });
    },
  },

  cancel_job: {
    description: 'Stops a running job.',
    input: z.strictObject({ id: z.string().min(1) }),
    writes: true,
    agent: false,
    run: async ({ id }) => {
      const entry = jobs.get(id);
      if (!entry) throw new UserError(`There is no job ${id}`);
      entry.controller.abort();
    },
  },

  propose_changes: {
    description: 'Stores a plan to add or remove tags. Changes no tag until a person applies it.',
    input: z.strictObject({
      query: fileQuery.optional(),
      file_ids: z.array(fileId).optional(),
      add: z.array(tag).optional(),
      remove: z.array(tag).optional(),
      title: z.string().min(1),
    }),
    writes: true,
    agent: true,
    run: async (input, ctx) => proposeChanges(ctx.db, input, planSource(ctx)),
  },

  rename_tag: {
    description: 'Stores a plan to rename a tag on every file that has it.',
    input: z.strictObject({ from: tag, to: tag }),
    writes: true,
    agent: true,
    run: async ({ from, to }, ctx) => proposeRename(ctx.db, from, to, planSource(ctx)),
  },

  apply_plan: {
    description: 'Applies a stored plan by id. Starts a job.',
    input: planId,
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, ctx) => {
      const facets = await loadFacets(ctx.config);
      const plan = claimPlan(ctx.db, id); // no `await` from here to the job, so no gap to race in
      const start = { plan_id: id, total: plan.ops.length };
      return startJob(
        'apply',
        ctx,
        async (run) => {
          const applied = await applyPlan(ctx.db, plan, facets, run, ctx.config.max_tags);
          refreshTags(ctx.db, facets);
          run.update({ failed: Object.keys(applied.errors ?? {}).length });
          ctx.emit({ type: 'files', ids: applied.ops.map((op) => op.file_id) });
        },
        start,
      );
    },
  },

  undo_plan: {
    description: 'Reverses an applied plan by id. Starts a job.',
    input: planId,
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, ctx) => {
      const plan = requirePlan(ctx.db, id);
      if (plan.status !== 'applied') throw new UserError(`Plan ${id} is ${plan.status}`);
      refuseIfBusy(id);
      const facets = await loadFacets(ctx.config);
      const start = { plan_id: id, total: plan.ops.length };
      return startJob(
        'undo',
        ctx,
        async (run) => {
          const undone = await undoPlan(ctx.db, plan, run);
          refreshTags(ctx.db, facets);
          run.update({ failed: Object.keys(undone.errors ?? {}).length });
          ctx.emit({ type: 'files', ids: plan.ops.map((op) => op.file_id) });
        },
        start,
      );
    },
  },

  get_plan: {
    description: 'One plan, with its ops.',
    input: planId,
    writes: false,
    agent: true,
    run: async ({ id }, { db }) => requirePlan(db, id),
  },

  discard_plan: {
    description: 'Deletes a plan that was never applied.',
    input: planId,
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, { db }) => {
      const { status } = requirePlan(db, id);
      if (status !== 'proposed') throw new UserError(`Plan ${id} is ${status}, so it stays`);
      if (db.planOps(id).length > 0) {
        throw new UserError(`Plan ${id} ran part of the way. Apply it, and then it can be undone`);
      }
      db.deletePlan(id);
    },
  },

  list_plans: {
    description: 'Plans, newest first, without their ops.',
    input: z.strictObject({
      status: z.enum(['proposed', 'applying', 'applied', 'undone', 'failed']).optional(),
    }),
    writes: false,
    agent: true,
    run: async ({ status }, { db }) => {
      recoverPlans(db);
      return db.listPlans(status);
    },
  },

  list_reviews: {
    description: 'Items waiting for a person, by tag and then confidence.',
    input: z.strictObject({ tag: tag.optional(), limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    run: async (filter, { db }) => db.listReviews(filter),
  },

  resolve_reviews: {
    description: 'Accepts or rejects review items. Accepting only builds a plan.',
    input: z.strictObject({ ids: z.array(z.int().positive()), accept: z.boolean() }),
    writes: true,
    agent: true,
    approval: true,
    run: async ({ ids, accept }, ctx) => {
      const { db } = ctx;
      const open = (item: ReviewItem) =>
        db.reviewsForFile(item.file_id).some((other) => other.id === item.id);
      const items = db.reviewsByIds(ids).filter(open);
      if (items.length === 0) return null;
      const settled = items.map((item) => item.id);
      if (!accept) {
        db.resolveReviews(settled, 'rejected');
        emitReviews(ctx);
        return null;
      }
      const openFacets = (await loadFacets(ctx.config)).filter((facet) => facet.open);
      const plan = db.transaction(() => {
        for (const item of items) {
          const id = tagFacet(item.tag);
          if (openFacets.some((facet) => facet.id === id)) {
            db.setVocabulary(id, item.tag.slice(item.tag.indexOf(':') + 1), 'active');
          }
        }
        db.resolveReviews(settled, 'accepted');
        return proposeReviews(db, items, planSource(ctx));
      });
      emitReviews(ctx);
      return plan;
    },
  },

  suggest_tags: {
    description:
      'Asks the chat model for new tags, as review items. Writes no tags, but sends file data to the provider and costs money.',
    input: z.strictObject({ id: fileId }),
    writes: true,
    agent: true,
    approval: true,
    run: async ({ id }, ctx) => {
      const { db, config } = ctx;
      const file = servableFile(ctx, id);
      if (!file) throw new UserError(`File ${id} is not in a library`);
      const chat = await resolveChatModel(config);
      const verifier = await resolveModel(config);
      const state = await extractFile(file.path, config);
      if (isFailed(state)) throw new UserError(`${file.path}: ${state.warnings.join('; ')}`);
      const openFacets = (await loadFacets(config)).filter((facet) => facet.open);
      const retired = db
        .listVocabulary()
        .filter((entry) => entry.state === 'retired')
        .map((entry) => `${entry.facet}:${entry.value}`);
      const vocabulary = db.tagCounts().slice(0, VOCABULARY_SHOWN);
      const tags = await suggest(
        state,
        vocabulary.map((row) => row.tag),
        chat,
        {
          openFacets: openFacets.map((facet) => facet.id),
          retired: [...retired, ...db.rejectedTags(id)],
          verifier,
        },
      );
      for (const name of tags) {
        db.proposeVocabulary(tagFacet(name), name.slice(name.indexOf(':') + 1));
        const reason = 'Suggested by the chat model';
        db.addReview({ file_id: id, kind: 'suggest', tag: name, confidence: null, reason });
      }
      emitReviews(ctx);
      return db.reviewsForFile(id).filter((item) => tags.includes(item.tag));
    },
  },

  set_vocabulary: {
    description: 'Activates or retires a value of an open facet.',
    input: z.strictObject({
      facet: z.string().min(1),
      value: z.string().min(1),
      state: z.enum(['active', 'retired']),
    }),
    writes: true,
    agent: false,
    run: async ({ facet, value, state }, { db, config }) => {
      const open = (await loadFacets(config)).some((entry) => entry.id === facet && entry.open);
      if (!open) throw new UserError(`${facet} is not an open facet`);
      db.setVocabulary(facet, value, state);
    },
  },

  cleanup_report: {
    description: 'Near-duplicate tags, tags on one file, and over-broad tags.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { db }) => cleanupReport(db),
  },

  get_config: {
    description: 'The config and its JSON Schema.',
    input: nothing,
    writes: false,
    agent: false,
    run: async (_input, { config }) => ({ config, schema: configJsonSchema() }),
  },

  set_config: {
    description: 'Validates and saves part of the config.',
    input: z.record(z.string(), z.unknown()),
    writes: true,
    agent: false,
    run: async (change, ctx) => {
      Object.assign(ctx.config, await saveConfig(change));
      return ctx.config;
    },
  },

  set_api_key: {
    description: 'Stores an API key.',
    input: z.strictObject({
      provider: z.enum([
        'openai',
        'typesafe',
        'gateway',
        'cloudflare',
        'openrouter',
        'compatible',
        'chat',
      ]),
      key: z.string().min(1),
    }),
    writes: true,
    agent: false,
    run: async ({ provider, key }) => setApiKey(provider, key),
  },

  reveal_file: {
    description: 'Shows a file in the file manager.',
    input: z.strictObject({ id: fileId }),
    writes: false,
    agent: false,
    run: async ({ id }, ctx) => {
      const file = servableFile(ctx, id);
      if (!file) throw new UserError(`File ${id} is not in a library`);
      reveal(file.path);
    },
  },

  doctor: {
    description: 'Checks the runtime, the key, each volume and optional tools.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, ctx) => doctor(ctx),
  },
};

/** True when `name` is in the table, for input from outside. */
export const isToolName = (name: string): name is ToolName => Object.hasOwn(tools, name);

/**
 * The one way in for everything but chat, whose SDK validates with the same schema and holds
 * approval itself. The checks here are the last line behind each front end's own.
 */
export async function callTool<K extends ToolName>(
  name: K,
  input: ToolMap[K][0],
  ctx: Context,
): Promise<ToolMap[K][1]> {
  const tool = tools[name] as unknown as Tool<unknown, ToolMap[K][1]>;
  if (isModel(ctx) && !tool.agent) throw new UserError(`${name} is not offered to a model`);
  if (isModel(ctx) && tool.approval && !ctx.approved) {
    throw new UserError(`${name} needs a person to approve it`);
  }
  return tool.run(parseWith(tool.input, input, name), ctx);
}

/** Opens what a front end needs. The caller closes `db`. */
export async function openContext(
  caller: Context['caller'],
  emit: Context['emit'] = () => {},
): Promise<Context> {
  const config = await loadConfig();
  return { db: openDb(), config, caller, emit };
}
