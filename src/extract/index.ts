/** Runs the pipeline for a file in a worker pool. A hang or a parser error costs that one file. */
import { existsSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, resolve } from 'node:path';
import mime from 'mime';
import { Piscina } from 'piscina';
import type { Config } from '../core/config.ts';
import { UserError } from '../core/config.ts';
import type { FileState } from '../types.ts';
import { extractors } from './extractors.ts';
import { cacheExtraction, cachedExtraction } from './cache.ts';
import { createScheduler } from './scheduler.ts';

export { optionalTools } from './tools.ts';

/** Source runs `worker.ts` beside this file. A bundle may put this code in any chunk of `dist/`. */
function workerFile(): string {
  if (import.meta.url.endsWith('.ts')) return new URL('./worker.ts', import.meta.url).href;
  const found = ['./worker.mjs', './extract/worker.mjs', '../extract/worker.mjs']
    .map((path) => new URL(path, import.meta.url))
    .find(existsSync);
  if (!found) throw new Error(`no extract/worker.mjs near ${import.meta.url}`);
  return found.href;
}

const threads = Math.min(availableParallelism(), 4);
/** Tasks wait here, not in the pool, so that time in a queue never counts against a timeout. */
const schedule = createScheduler(threads);
let pool: Piscina | undefined;

/** The shared pool, started on first use. Idle workers do not keep the process alive. */
export const workerPool = () =>
  (pool ??= new Piscina({
    filename: workerFile(),
    minThreads: 0,
    maxThreads: threads,
    idleTimeout: 10_000,
  }));

/** Runs one export of worker.ts, terminating its worker after `timeoutMs`. */
export const runTask = <T>(name: string, input: unknown, timeoutMs: number): Promise<T> =>
  schedule(async () => {
    const controller = new AbortController();
    // Not `AbortSignal.timeout`, whose timer is unref'd. A worker that dies while starting leaves its
    // task waiting with nothing else alive, and Node would exit mid-job instead of failing the file.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return (await workerPool().run(typeof input === 'function' ? input() : input, {
        name,
        signal: controller.signal,
      })) as T;
    } finally {
      clearTimeout(timer);
    }
  }, name === 'renderThumbnail');

function failure(path: string, size: number, warning: string): FileState & { mime: string } {
  const type = mime.getType(path) ?? 'application/octet-stream';
  const metadata = { name: basename(path), size, mime: type };
  return { text: '', images: [], metadata, warnings: [warning], mime: type };
}

const inFlight = new Map<string, Promise<FileState & { mime: string }>>();
const fingerprint = (info: BigIntStats) =>
  [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');

/**
 * Turns a file into a `FileState`, within the budgets. This never rejects for a bad file: a file
 * that could not be read comes back with a warning, and `isFailed` says so.
 */
export async function extractFile(
  path: string,
  config: Config,
): Promise<FileState & { mime: string }> {
  for (const { use } of config.pipeline) {
    const unknown = use.find((id) => !(id in extractors));
    if (unknown) throw new UserError(`pipeline.use: unknown extractor "${unknown}"`);
  }
  const file = resolve(path); // always absolute, so a name can never pass as a tool's flag
  const info = await lstat(file, { bigint: true }).catch(() => undefined);
  if (!info?.isFile()) return failure(file, 0, 'not a regular file');
  const timeoutMs = config.budget.timeout_seconds * 1000;
  const input = { path: file, name: basename(file), size: Number(info.size), config };
  const stamp = fingerprint(info);
  const key = JSON.stringify([
    file,
    stamp,
    config.pipeline,
    config.budget,
    config.send_images,
    process.env.PATH,
  ]);
  const cached = cachedExtraction(key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return structuredClone(await pending);
  const work = async () => {
    const state = await runTask<FileState & { mime: string }>(
      'extract',
      () => ({ ...input, deadline: Date.now() + timeoutMs }),
      timeoutMs,
    );
    const after = await lstat(file, { bigint: true }).catch(() => undefined);
    if (after?.isFile() && fingerprint(after) === stamp) cacheExtraction(key, state);
    return state;
  };
  const running = work().catch((error: unknown) => {
    const timedOut = (error as Error).name === 'AbortError';
    return failure(
      file,
      Number(info.size),
      timedOut ? 'timed out' : `worker failed: ${(error as Error).message}`,
    );
  });
  inFlight.set(key, running);
  try {
    return structuredClone(await running);
  } finally {
    if (inFlight.get(key) === running) inFlight.delete(key);
  }
}

/** True when extraction found nothing and something went wrong. See docs/pipeline.md. */
export function isFailed(state: FileState): boolean {
  const extra = Object.keys(state.metadata).some((key) => !['name', 'size', 'mime'].includes(key));
  return !state.text && !state.images.length && !extra && state.warnings.length > 0;
}
