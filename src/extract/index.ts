/** Runs the pipeline for a file in a worker pool. A hang or a parser error costs that one file. */
import { existsSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, resolve } from 'node:path';
import mime from 'mime';
import pLimit from 'p-limit';
import { Piscina } from 'piscina';
import type { Config } from '../core/config.ts';
import { UserError } from '../core/config.ts';
import type { FileState } from '../types.ts';
import { extractors } from './extractors.ts';

export { optionalTools } from './extractors.ts';

/** Source runs `worker.ts` beside this file. A bundle may put this code in any chunk of `dist/`. */
function workerFile(): string {
  if (import.meta.url.endsWith('.ts')) return new URL('./worker.ts', import.meta.url).href;
  const found = ['./worker.mjs', './extract/worker.mjs', '../extract/worker.mjs']
    .map((path) => new URL(path, import.meta.url))
    .find(existsSync);
  if (!found) throw new Error(`no extract/worker.mjs near ${import.meta.url}`);
  return found.href;
}

const threads = availableParallelism();
/** Tasks wait here, not in the pool, so that time in a queue never counts against a timeout. */
const limit = pLimit(threads);
let pool: Piscina | undefined;

/** The shared pool, started on first use. Idle workers do not keep the process alive. */
export const workerPool = () =>
  (pool ??= new Piscina({ filename: workerFile(), minThreads: 0, maxThreads: threads }));

/** Runs one export of worker.ts, terminating its worker after `timeoutMs`. */
export const runTask = <T>(name: string, input: unknown, timeoutMs: number): Promise<T> =>
  limit(
    () => workerPool().run(input, { name, signal: AbortSignal.timeout(timeoutMs) }) as Promise<T>,
  );

function failure(path: string, size: number, warning: string): FileState & { mime: string } {
  const type = mime.getType(path) ?? 'application/octet-stream';
  const metadata = { name: basename(path), size, mime: type };
  return { text: '', images: [], metadata, warnings: [warning], mime: type };
}

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
  const info = await lstat(file).catch(() => undefined);
  if (!info?.isFile()) return failure(file, 0, 'not a regular file');
  const timeoutMs = config.budget.timeout_seconds * 1000;
  const input = { path: file, name: basename(file), size: info.size, config };
  try {
    const deadline = Date.now() + timeoutMs;
    return await runTask('extract', { ...input, deadline }, timeoutMs);
  } catch (error) {
    const timedOut = (error as Error).name === 'AbortError';
    return failure(
      file,
      info.size,
      timedOut ? 'timed out' : `worker failed: ${(error as Error).message}`,
    );
  }
}

/** True when extraction found nothing and something went wrong. See docs/pipeline.md. */
export function isFailed(state: FileState): boolean {
  const extra = Object.keys(state.metadata).some((key) => !['name', 'size', 'mime'].includes(key));
  return !state.text && !state.images.length && !extra && state.warnings.length > 0;
}
