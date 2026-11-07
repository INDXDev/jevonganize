/** The thumbnail cache. See docs/storage.md. Decoding happens in the pool, never in the server. */
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { access, lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSchema, paths } from '../core/config.ts';
import type { FileRow } from '../types.ts';
import { runTask } from './pool.ts';

/** shortcut: fixed, since `thumbnail` takes no config, pass the budget in if users need to tune it. */
const RENDER_TIMEOUT_MS = 30_000;
const MAX_SOURCE_BYTES = 200 * 2 ** 20;

/** Where one thumbnail lives: its webp, and the marker left when it could not be drawn. */
type CacheEntry = { dir: string; webpPath: string; failedMarker: string };

const fileExists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Renders under way, by webp path, so that two requests for one thumbnail share a render. */
const inFlight = new Map<string, Promise<string | null>>();

/** The content hash without its algorithm prefix, or a hash of the file's identity. */
function cacheKey(contentHash: string | null | undefined, info: BigIntStats): string {
  const fromContent = contentHash?.replace(/^\w+:/, '');
  if (fromContent !== undefined) return fromContent;
  const identity = [info.dev, info.ino, info.size, info.mtimeNs].join(':');
  return createHash('sha256').update(identity).digest('hex');
}

/** Files fan out by the key's first two characters, so that no directory grows too large. */
function cacheEntry(key: string, edge: number): CacheEntry {
  const dir = join(paths.thumbnails(), key.slice(0, 2));
  return {
    dir,
    webpPath: join(dir, `${key}-${edge}.webp`),
    failedMarker: join(dir, `${key}-${edge}.fail`),
  };
}

/** Renders in the pool. A failure leaves a marker, so that a file that cannot render is not retried. */
async function render(sourcePath: string, edge: number, entry: CacheEntry) {
  await mkdir(entry.dir, { recursive: true });
  try {
    await runTask(
      'renderThumbnail',
      () => ({
        path: sourcePath,
        edge,
        outPath: entry.webpPath,
        deadline: Date.now() + RENDER_TIMEOUT_MS,
        budget: configSchema.parse({}).budget,
      }),
      RENDER_TIMEOUT_MS,
    );
    return entry.webpPath;
  } catch {
    await writeFile(entry.failedMarker, '');
    return null;
  }
}

/**
 * The path of a cached webp, or null if this file has none. `hash` is `file.hash`, which `FileRow`
 * leaves out. Without it the key comes from the file's identity, as for a file not yet organized.
 */
export async function thumbnail(
  file: FileRow & { hash?: string | null },
  size: 256 | 1024,
): Promise<string | null> {
  const info = await lstat(file.path, { bigint: true }).catch(() => undefined);
  if (!info?.isFile()) return null;
  const entry = cacheEntry(cacheKey(file.hash, info), size);
  if (await fileExists(entry.webpPath)) return entry.webpPath;
  const failedBefore = await fileExists(entry.failedMarker);
  if (failedBefore || info.size > MAX_SOURCE_BYTES) return null;
  const pending = inFlight.get(entry.webpPath);
  if (pending) return pending;
  const running = render(file.path, size, entry);
  inFlight.set(entry.webpPath, running);
  try {
    return await running;
  } finally {
    inFlight.delete(entry.webpPath);
  }
}
