/** The tools on the folders in the index: adding, removing and scanning them, and `status`. */
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Job, Library, ProviderName, Status } from '../../types.ts';
import { ifExists, indexedPath, UserError } from '../config.ts';
import { KEY_ENV, keySource } from '../credentials.ts';
import { loadFacets } from '../facets.ts';
import type { JobRun } from '../plans.ts';
import { secretRoot } from '../exclusions.ts';
import { scanLibrary } from '../scan.ts';
import { browseDirs } from './browse.ts';
import { jobs, snapshot, startJob } from './jobs.ts';
import {
  type Context,
  emitReviews,
  libraries,
  nothing,
  refreshTags,
  taggable,
  type ToolTable,
} from './shared.ts';
import { syncWatchers } from './watching.ts';

/** Providers with a key from any source. */
async function providersWithKeys(): Promise<ProviderName[]> {
  const providers = Object.keys(KEY_ENV) as ProviderName[];
  const sources = await Promise.all(providers.map((name) => keySource(name)));
  return providers.filter((_name, index) => sources[index] !== null);
}

/** The counts a scan job reports, summed over its roots. */
type ScanTotals = NonNullable<Job['scan']>;

const emptyTotals = (): ScanTotals => ({
  files: 0,
  added: 0,
  changed: 0,
  moved: 0,
  removed: 0,
  restores: 0,
  skipped: 0,
});

/** Adds one root's counts to the running totals. */
function addTotals(totals: ScanTotals, scanned: ScanTotals): void {
  for (const key of Object.keys(totals) as (keyof ScanTotals)[]) totals[key] += scanned[key];
}

/**
 * Scans each root in turn and adds up the results. `askedByName` says the caller named the one
 * root, so its failure is the answer rather than a warning.
 */
async function scanRoots(ctx: Context, roots: string[], askedByName: boolean, job: JobRun) {
  const totals = emptyTotals();
  const warnings: string[] = [];
  const ids: number[] = [];
  for (const root of roots) {
    if (job.signal.aborted) break;
    const filesBefore = totals.files;
    const onProgress = ({ done, current }: { done: number; current: string }) =>
      job.update({ done: filesBefore + done, total: filesBefore + done, current });
    try {
      const scanned = await scanLibrary(ctx.db, ctx.config, root, onProgress);
      addTotals(totals, scanned);
      warnings.push(...scanned.warnings);
      ids.push(...scanned.ids);
    } catch (error) {
      // One unplugged drive must not stop the others.
      if (!(error instanceof UserError) || askedByName) throw error;
      warnings.push(error.message);
    }
  }
  return { totals, warnings, ids };
}

/** Checks the roots to scan, then scans them in a job and tells the UI what changed. */
async function startScan(ctx: Context, path: string | undefined): Promise<Job> {
  const { db, config } = ctx;
  const libraryPaths = db.listLibraries().map((library) => library.path);
  const askedByName = path !== undefined;
  const roots = askedByName ? [indexedPath(path)] : libraryPaths;
  const notALibrary = roots.find((root) => !libraryPaths.includes(root));
  if (notALibrary !== undefined) throw new UserError(`${notALibrary} is not a library`);
  const facets = await loadFacets(config);
  return startJob('scan', ctx, async (job) => {
    const { totals, warnings, ids } = await scanRoots(ctx, roots, askedByName, job);
    refreshTags(db, facets);
    job.update({ done: totals.files, total: totals.files, scan: totals, warnings });
    if (ids.length > 0) ctx.emit({ type: 'files', ids });
    if (totals.restores > 0) emitReviews(ctx);
  });
}

/** What `status` reports. */
async function statusReport({ db, config }: Context): Promise<Status> {
  return {
    libraries: await libraries(db),
    ...db.stats(),
    jobs: [...jobs.values()].map((running) => snapshot(running.job)),
    provider: config.provider.name,
    model: config.provider.model ?? '',
    has_key: (await keySource(config.provider.name)) !== null,
    keys: await providersWithKeys(),
  };
}

/** Adds a folder to the index and watches it. A secret folder is refused. */
async function addLibrary({ db, config }: Context, path: string): Promise<Library> {
  const root = indexedPath(path);
  const rootInfo = await ifExists(stat(root));
  if (!rootInfo?.isDirectory()) throw new UserError(`${root} is not a folder`);
  // By real path, or a link would carry a secret folder past rules that go by whole path.
  if (secretRoot(config, root)) throw new UserError(`${root} is excluded`);
  db.addLibrary(root);
  syncWatchers();
  const added = db.listLibraries().find((library) => library.path === root);
  return { path: root, files: 0, scanned_at: null, ...added, taggable: await taggable(root) };
}

/** The tools on libraries. */
export const libraryTools = {
  status: {
    description: 'Libraries, counts, jobs, and the provider in use.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, ctx) => statusReport(ctx),
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
    run: async ({ path }, ctx) => addLibrary(ctx, path),
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
    description: 'Lists a folder and the usual places, for the folder picker.',
    input: z.strictObject({ path: z.string().optional() }),
    writes: false,
    agent: false,
    run: async ({ path }) => browseDirs(path),
  },

  scan: {
    description: 'Updates the index from the disk. Local and free. Starts a job.',
    input: z.strictObject({ path: z.string().optional() }),
    writes: true,
    agent: true,
    run: async ({ path }, ctx) => startScan(ctx, path),
  },
} satisfies Partial<ToolTable>;
