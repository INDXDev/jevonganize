/** Keeps the index following the disk while a server runs. */
import { loadFacets } from '../facets.ts';
import { watchLibrary } from '../watch.ts';
import { type Context, refreshTags } from './shared.ts';

/** A refresh rewrites every file's weight, so a stream of watch events shares one. */
const REFRESH_MS = 5000;

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

/** Matches the watchers to the libraries, after one was added or removed. */
export function syncWatchers(): void {
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
