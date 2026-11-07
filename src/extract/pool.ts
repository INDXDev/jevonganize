/** The worker pool that every parse and render runs in. A hang or a crash costs that one task. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Piscina } from 'piscina';
import { createScheduler } from './scheduler.ts';
import { findTool } from './tools.ts';

const MAX_THREADS = 4;
const IDLE_TIMEOUT_MS = 10_000;
const WARM_IDLE_TIMEOUT_MS = 60_000;

/** Source runs `worker.ts` beside this file. A bundle may put this code in any chunk of `dist/`. */
function workerFile(): string {
  const runningFromSource = import.meta.url.endsWith('.ts');
  if (runningFromSource) return new URL('./worker.ts', import.meta.url).href;
  const found = ['./worker.mjs', './extract/worker.mjs', '../extract/worker.mjs']
    .map((path) => new URL(path, import.meta.url))
    .find(existsSync);
  if (!found) throw new Error(`no extract/worker.mjs near ${import.meta.url}`);
  return found.href;
}

const threads = Math.min(availableParallelism(), MAX_THREADS);
/** Tasks wait here, not in the pool, so that time in a queue never counts against a timeout. */
const schedule = createScheduler(threads);
let pool: Piscina | undefined;
let idleTimeoutMs = IDLE_TIMEOUT_MS;

/** For a process that stays up: a wave of thumbnails then finds its workers already loaded. */
export function keepWorkersWarm(): void {
  idleTimeoutMs = WARM_IDLE_TIMEOUT_MS;
}

/**
 * Where each worker keeps its `soffice` profile, private to this process. A worker is terminated
 * with no chance to clean up, so what outlives it is removed from here.
 */
function removeProfilesWithWorkers(created: Piscina, root: string): void {
  created.on('workerDestroy', ({ id }: { id: number }) => {
    void rm(join(root, String(id)), { recursive: true, force: true });
  });
  process.once('exit', () => rmSync(root, { recursive: true, force: true }));
}

/** The shared pool, started on first use. Idle workers do not keep the process alive. */
export function workerPool(): Piscina {
  if (pool) return pool;
  const profileRoot = findTool('soffice') && mkdtempSync(join(tmpdir(), 'jevonganize-soffice-'));
  pool = new Piscina({
    filename: workerFile(),
    minThreads: 0,
    maxThreads: threads,
    idleTimeout: idleTimeoutMs,
    workerData: { profileRoot },
  });
  if (profileRoot) removeProfilesWithWorkers(pool, profileRoot);
  return pool;
}

/**
 * Runs one export of worker.ts, terminating its worker after `timeoutMs`. A function `input` is
 * called when the task starts, so that a deadline inside it does not include time in the queue.
 * Thumbnails run in the foreground, because a person is waiting for them.
 */
export const runTask = <T>(name: string, input: unknown, timeoutMs: number): Promise<T> => {
  const isThumbnail = name === 'renderThumbnail';
  return schedule(async () => {
    const controller = new AbortController();
    // Not `AbortSignal.timeout`, whose timer is unref'd. A worker that dies while starting leaves its
    // task waiting with nothing else alive, and Node would exit mid-job instead of failing the file.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const task = typeof input === 'function' ? input() : input;
      return (await workerPool().run(task, { name, signal: controller.signal })) as T;
    } finally {
      clearTimeout(timer);
    }
  }, isThumbnail);
};
