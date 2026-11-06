/** The folders in the index, and scanning them. */
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { ProviderName } from '../../types.ts';
import { ifExists, indexedPath, UserError } from '../config.ts';
import { KEY_ENV, keySource } from '../credentials.ts';
import { loadFacets } from '../facets.ts';
import type { JobRun } from '../plans.ts';
import { secretRoot } from '../exclusions.ts';
import { scanLibrary } from '../scan.ts';
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

/** Scans each root in turn and adds up the results. `named`: the caller asked for this root. */
async function scanRoots(ctx: Context, roots: string[], named: boolean, run: JobRun) {
  const totals = { files: 0, added: 0, changed: 0, moved: 0, removed: 0, restores: 0, skipped: 0 };
  const warnings: string[] = [];
  const ids: number[] = [];
  for (const root of roots) {
    if (run.signal.aborted) break;
    const before = totals.files;
    const onProgress = ({ done, current }: { done: number; current: string }) =>
      run.update({ done: before + done, total: before + done, current });
    try {
      const result = await scanLibrary(ctx.db, ctx.config, root, onProgress);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
        totals[key] += result[key];
      }
      warnings.push(...result.warnings);
      ids.push(...result.ids);
    } catch (error) {
      // One unplugged drive must not stop the others. Asked for by name, it is the answer.
      if (!(error instanceof UserError) || named) throw error;
      warnings.push(error.message);
    }
  }
  return { totals, warnings, ids };
}

/** The tools on libraries. */
export const libraryTools = {
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
      keys: await providersWithKeys(),
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
        const { totals, warnings, ids } = await scanRoots(ctx, roots, path !== undefined, run);
        refreshTags(db, facets);
        run.update({ done: totals.files, total: totals.files, scan: totals, warnings });
        if (ids.length > 0) ctx.emit({ type: 'files', ids });
        if (totals.restores > 0) emitReviews(ctx);
      });
    },
  },
} satisfies Partial<ToolTable>;
