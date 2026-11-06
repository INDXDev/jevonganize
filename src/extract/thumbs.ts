/** The thumbnail cache. See docs/storage.md. Decoding happens in the pool, never in the server. */
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configSchema, paths } from '../core/config.ts';
import type { FileRow } from '../types.ts';
import { runTask } from './index.ts';

/** shortcut: fixed, since `thumbnail` takes no config, pass the budget in if users need to tune it. */
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 200 * 2 ** 20;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const inFlight = new Map<string, Promise<string | null>>();

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
  const key =
    file.hash?.replace(/^\w+:/, '') ??
    createHash('sha256')
      .update([info.dev, info.ino, info.size, info.mtimeNs].join(':'))
      .digest('hex');
  const dir = join(paths.thumbnails(), key.slice(0, 2));
  const out = join(dir, `${key}-${size}.webp`);
  const fail = join(dir, `${key}-${size}.fail`);
  if (await exists(out)) return out;
  if ((await exists(fail)) || info.size > MAX_BYTES) return null;
  const pending = inFlight.get(out);
  if (pending) return pending;
  const generate = async () => {
    await mkdir(dir, { recursive: true });
    try {
      await runTask(
        'renderThumbnail',
        () => ({
          path: file.path,
          size,
          out,
          deadline: Date.now() + TIMEOUT_MS,
          budget: configSchema.parse({}).budget,
        }),
        TIMEOUT_MS,
      );
      return out;
    } catch {
      await writeFile(fail, '');
      return null;
    }
  };
  const running = generate();
  inFlight.set(out, running);
  try {
    return await running;
  } finally {
    inFlight.delete(out);
  }
}
