/** The thumbnail cache. See docs/storage.md. Decoding happens in the pool, never in the server. */
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sharp } from 'sharp';
import { paths } from '../core/config.ts';
import type { FileRow } from '../types.ts';
import { openPdf, picture, renderPage, sniff } from './extractors.ts';
import { runTask } from './index.ts';

/** shortcut: fixed, since `thumbnail` takes no config, pass the budget in if users need to tune it. */
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 200 * 2 ** 20;

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function decode(path: string, size: number): Promise<Sharp> {
  const mime = await sniff(path);
  if (mime.startsWith('image/')) return picture(path, mime);
  if (mime !== 'application/pdf') throw new Error(`no thumbnail for ${mime}`);
  const { default: sharp } = await import('sharp');
  const doc = await openPdf(path);
  try {
    return sharp(await renderPage(doc, 1, size));
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Worker task: writes the webp under a temp name, then renames it into place. */
export async function renderThumbnail(input: { path: string; size: number; out: string }) {
  const temp = `${input.out}.${randomUUID()}.tmp`;
  try {
    const image = await decode(input.path, input.size);
    await image
      .autoOrient()
      .resize({ width: input.size, height: input.size, fit: 'inside', withoutEnlargement: true })
      .webp()
      .toFile(temp);
    await rename(temp, input.out);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
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
  await mkdir(dir, { recursive: true });
  try {
    await runTask('renderThumbnail', { path: file.path, size, out }, TIMEOUT_MS);
    return out;
  } catch {
    await writeFile(fail, ''); // a hostile file is parsed once, not on every view
    return null;
  }
}
