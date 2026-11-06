/** Batches scan tag reads and offloads larger batches from the server. All OS access stays in tags.ts. */
import { existsSync } from 'node:fs';
import { Piscina } from 'piscina';
import type { Tag } from '../types.ts';
import { readBatch } from './tag-worker.ts';

/** One scan path's disk tags, or a failed read that must leave its old mirror intact. */
export type TagRead = { path: string } & ({ tags: Tag[] } | { error: string });

let pool: Piscina | undefined;

function workerFile(): string {
  if (import.meta.url.endsWith('.ts')) return new URL('./tag-worker.ts', import.meta.url).href;
  const found = ['./tag-worker.mjs', './core/tag-worker.mjs', '../core/tag-worker.mjs']
    .map((path) => new URL(path, import.meta.url))
    .find(existsSync);
  if (!found) throw new Error(`no core/tag-worker.mjs near ${import.meta.url}`);
  return found.href;
}

/** Offloads a large batch; failures preserve each old observation instead of clearing its tags. */
export async function readScanTags(paths: string[]): Promise<TagRead[]> {
  if (!paths.length) return [];
  if (paths.length < 32) return readBatch(paths);
  pool ??= new Piscina({
    filename: workerFile(),
    minThreads: 0,
    maxThreads: 1,
    idleTimeout: 10_000,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return (await pool.run(paths, { name: 'readBatch', signal: controller.signal })) as TagRead[];
  } catch (error) {
    return paths.map((path) => ({ path, error: (error as Error).message }));
  } finally {
    clearTimeout(timer);
  }
}
