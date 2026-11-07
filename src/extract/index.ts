/** Turns a file into a `FileState` in the worker pool, at most once at a time for each version. */
import type { BigIntStats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import mime from 'mime';
import type { Config } from '../core/config.ts';
import { UserError } from '../core/config.ts';
import { isScreenCapture } from '../core/tags.ts';
import type { FileState } from '../types.ts';
import { extractors } from './extractors.ts';
import { cacheExtraction, cachedExtraction } from './cache.ts';
import { runTask } from './pool.ts';

export { keepWorkersWarm, workerPool } from './pool.ts';
export { optionalTools } from './tools.ts';

type Extraction = FileState & { mime: string };

/** Keys that every extraction writes. Anything beyond them means an extractor found something. */
const BASE_METADATA = ['name', 'size', 'mime'];

/** Extractions under way, so that two callers asking for the same file share one task. */
const inFlight = new Map<string, Promise<Extraction>>();

/** What a file that could not be read comes back as: its name, size, and why. */
function failure(path: string, size: number, warning: string): Extraction {
  const type = mime.getType(path) ?? 'application/octet-stream';
  const metadata = { name: basename(path), size, mime: type };
  return { text: '', images: [], metadata, warnings: [warning], mime: type };
}

/** Changes whenever the file may have: a different inode, size or either timestamp. */
const fingerprint = (info: BigIntStats) =>
  [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');

async function regularFileInfo(path: string): Promise<BigIntStats | undefined> {
  const info = await lstat(path, { bigint: true }).catch(() => undefined);
  return info?.isFile() ? info : undefined;
}

function checkPipeline(config: Config): void {
  for (const { use } of config.pipeline) {
    const unknown = use.find((id) => !(id in extractors));
    if (unknown) throw new UserError(`pipeline.use: unknown extractor "${unknown}"`);
  }
}

/** Everything that can change what the pipeline produces. PATH decides which tools it finds. */
const cacheKey = (path: string, info: BigIntStats, config: Config) =>
  JSON.stringify([
    path,
    fingerprint(info),
    config.pipeline,
    config.budget,
    config.send_images,
    process.env.PATH,
  ]);

/** Runs the worker task, and caches the result only if the file did not change meanwhile. */
async function extractInWorker(path: string, info: BigIntStats, config: Config, key: string) {
  const timeoutMs = config.budget.timeout_seconds * 1000;
  const task = {
    path,
    name: basename(path),
    size: Number(info.size),
    config,
    screenCapture: isScreenCapture(path),
  };
  const state = await runTask<Extraction>(
    'extract',
    () => ({ ...task, deadline: Date.now() + timeoutMs }),
    timeoutMs,
  );
  const after = await regularFileInfo(path);
  const unchanged = after !== undefined && fingerprint(after) === fingerprint(info);
  if (unchanged) cacheExtraction(key, state);
  return state;
}

function workerFailure(path: string, info: BigIntStats, error: unknown): Extraction {
  const { name, message } = error as Error;
  const warning = name === 'AbortError' ? 'timed out' : `worker failed: ${message}`;
  return failure(path, Number(info.size), warning);
}

/**
 * Turns a file into a `FileState`, within the budgets. This never rejects for a bad file: a file
 * that could not be read comes back with a warning, and `isFailed` says so.
 */
export async function extractFile(
  path: string,
  config: Config,
): Promise<FileState & { mime: string }> {
  checkPipeline(config);
  const file = resolve(path); // always absolute, so a name can never pass as a tool's flag
  const info = await regularFileInfo(file);
  if (!info) return failure(file, 0, 'not a regular file');
  const key = cacheKey(file, info, config);
  const cached = cachedExtraction(key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return structuredClone(await pending);
  const running = extractInWorker(file, info, config, key).catch((error: unknown) =>
    workerFailure(file, info, error),
  );
  inFlight.set(key, running);
  try {
    return structuredClone(await running);
  } finally {
    if (inFlight.get(key) === running) inFlight.delete(key);
  }
}

/** True when extraction found nothing and something went wrong. See docs/pipeline.md. */
export function isFailed(state: FileState): boolean {
  const foundMetadata = Object.keys(state.metadata).some((key) => !BASE_METADATA.includes(key));
  const foundContent = Boolean(state.text) || state.images.length > 0 || foundMetadata;
  return !foundContent && state.warnings.length > 0;
}
