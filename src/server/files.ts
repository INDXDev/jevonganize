/** The routes that serve a file's bytes or its thumbnail. Files are addressed by id, never by path. */
import { constants } from 'node:fs';
import { lstat, open, readFile, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Context as HonoContext, Hono } from 'hono';
import { type Context, servableFile, thumbnailFile } from '../core/tools.ts';

/** Everything else may run script if a browser renders it, so it gets `CSP: sandbox`. */
const SAFE_TYPE =
  /^(image\/(png|jpeg|gif|webp|avif|bmp|heic|heif|tiff)|application\/pdf|text\/plain)$/;
/** How long a thumbnail or a hashed asset may be cached. */
export const ONE_YEAR_SECONDS = 31_536_000;

/** A byte range, or null when the header cannot be met. Several ranges get the whole file. */
export function parseRange(header: string | undefined, size: number) {
  const whole = { start: 0, end: size - 1, partial: false };
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return whole;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  const isSuffix = first === '';
  const start = isSuffix ? Math.max(size - Number(last), 0) : Number(first);
  const end = isSuffix || last === '' ? size - 1 : Math.min(Number(last), size - 1);
  const isUnsatisfiable = start > end || start >= size;
  return isUnsatisfiable ? null : { start, end, partial: true };
}

/** Opens a regular file without following links, or returns undefined. */
async function openRegularFile(path: string): Promise<FileHandle | undefined> {
  const isRegularFile = (await lstat(path).catch(() => undefined))?.isFile();
  if (!isRegularFile) return undefined;
  // O_NOFOLLOW fails if it turned into a link after the `lstat`.
  return open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => undefined);
}

function originalHeaders(mime: string | null): Headers {
  const type = mime ?? 'application/octet-stream';
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-type': type,
  });
  if (!SAFE_TYPE.test(type)) headers.set('content-security-policy', 'sandbox');
  return headers;
}

/** Streams an original. Refuses anything but a regular file at read time, links included. */
async function sendFile(c: HonoContext, path: string, mime: string | null): Promise<Response> {
  const handle = await openRegularFile(path);
  if (!handle) return c.text('Not found', 404);
  const { size } = await handle.stat();
  const headers = originalHeaders(mime);
  const range = parseRange(c.req.header('range'), size);
  if (!range) {
    await handle.close();
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (size === 0) {
    await handle.close();
    headers.set('content-length', '0');
    return new Response(null, { status: 200, headers });
  }
  headers.set('content-length', String(range.end - range.start + 1));
  if (range.partial) headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  const stream = handle.createReadStream({ start: range.start, end: range.end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range.partial ? 206 : 200,
    headers,
  });
}

/** The `:id` of a route, or 0, which no file has, when it is not a number. */
const fileId = (c: HonoContext) => {
  const text = c.req.param('id') ?? '';
  return /^\d+$/.test(text) ? Number(text) : 0;
};

/** Adds `/thumb/:id` and `/file/:id`. */
export function addFileRoutes(app: Hono, ctx: Context): void {
  app.get('/thumb/:id', async (c) => {
    const size = c.req.query('size') === '1024' ? 1024 : 256;
    const path = await thumbnailFile(ctx, fileId(c), size);
    if (!path) return c.text('Not found', 404);
    return new Response(await readFile(path), {
      headers: {
        'content-type': 'image/webp',
        'cache-control': `private, max-age=${ONE_YEAR_SECONDS}, immutable`,
      },
    });
  });

  app.get('/file/:id', async (c) => {
    const file = servableFile(ctx, fileId(c));
    return file ? sendFile(c, file.path, file.mime) : c.text('Not found', 404);
  });
}
