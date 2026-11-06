/** The content hash stored for a file. See docs/storage.md. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';

/** Larger files are hashed by sample: see docs/storage.md. */
const WHOLE_FILE_BYTES = 64 * 2 ** 20;
const WINDOW_BYTES = 2 ** 20;

async function wholeFileHash(handle: FileHandle): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of handle.createReadStream({ autoClose: false })) {
    hash.update(chunk as Uint8Array);
  }
  return `f1:${hash.digest('hex')}`;
}

async function sampledHash(handle: FileHandle, size: number): Promise<string> {
  const hash = createHash('sha256');
  hash.update(String(size));
  const windowStarts = [0, Math.floor(size / 2), size - WINDOW_BYTES];
  for (const start of windowStarts) {
    const window = Buffer.alloc(WINDOW_BYTES);
    const { bytesRead } = await handle.read(window, 0, WINDOW_BYTES, start);
    hash.update(window.subarray(0, bytesRead));
  }
  return `p1:${hash.digest('hex')}`;
}

const recent = new Map<string, { hash: string; expires: number }>();
const stamp = (info: BigIntStats) =>
  [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');

/** See docs/storage.md: the whole file, or for a large one its size and three windows. */
export async function contentHash(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile()) throw new Error('not a regular file');
    const before = stamp(info);
    const key = JSON.stringify([path, before]);
    const known = recent.get(key);
    if (known && known.expires > Date.now()) return known.hash;
    const size = Number(info.size);
    const hash = await (size <= WHOLE_FILE_BYTES
      ? wholeFileHash(handle)
      : sampledHash(handle, size));
    if (stamp(await handle.stat({ bigint: true })) === before) {
      if (recent.size >= 256) recent.delete(recent.keys().next().value!);
      recent.set(key, { hash, expires: Date.now() + 30_000 });
    }
    return hash;
  } finally {
    await handle.close();
  }
}
