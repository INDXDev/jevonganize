/** Keeps the index current between scans. See docs/tags.md for why this is `fs.watch`. */
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { scanLibrary, scanPaths } from './scan.ts';

const DEBOUNCE_MS = 300;

/**
 * Watches one library: a walk now and every `watch.walk_minutes`, plus `fs.watch` in between. The
 * walk is what guarantees correctness, so it keeps running when watching fails. All work is
 * serialized. Callers check `watch.enabled`. Returns a stop function that waits for running work.
 */
export function watchLibrary(
  db: Db,
  config: Config,
  root: string,
  handlers: { onChange: (ids: number[]) => void; onError: (error: unknown) => void },
): () => Promise<void> {
  const base = resolve(root);
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let queue = Promise.resolve();

  const enqueue = (job: () => Promise<number[]>) => {
    queue = queue
      .then(async () => {
        if (stopped) return;
        const ids = await job();
        if (ids.length) handlers.onChange(ids);
      })
      .catch(handlers.onError);
  };
  const walk = async () => (await scanLibrary(db, config, base)).ids;

  const flush = () => {
    timer = undefined;
    const paths = [...pending];
    pending.clear();
    enqueue(async () => {
      const { ids, needsWalk } = await scanPaths(db, config, base, paths);
      return needsWalk ? [...ids, ...(await walk())] : ids;
    });
  };

  let watcher: FSWatcher | undefined;
  try {
    // Every event type is treated alike: macOS reports an xattr change as `rename`.
    watcher = watch(base, { recursive: true }, (_event, name) => {
      pending.add(name === null ? base : join(base, name)); // no name: the root makes it walk
      timer ??= setTimeout(flush, DEBOUNCE_MS); // not reset per event, so a stream can't starve it
    });
    watcher.on('error', handlers.onError);
  } catch (error) {
    handlers.onError(error);
  }

  enqueue(walk);
  const interval = setInterval(() => enqueue(walk), config.watch.walk_minutes * 60_000);
  interval.unref();

  return async () => {
    stopped = true;
    watcher?.close();
    clearTimeout(timer);
    clearInterval(interval);
    await queue;
  };
}
