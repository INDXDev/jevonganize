/** The routes. The tool table is the API, so nothing here does the work itself. */
import { constants, existsSync } from 'node:fs';
import { lstat, open, readFile, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context as HonoContext, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { chat } from '../ai/chat.ts';
import { UserError } from '../core/config.ts';
import { sanitize } from '../core/sanitize.ts';
import {
  callTool,
  type Context,
  isToolName,
  servableFile,
  thumbnailFile,
  tools,
} from '../core/tools.ts';
import type { ServerEvent } from '../types.ts';
import { cookieName, guard } from './guard.ts';

const CSP =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
/** Everything else may run script if a browser renders it, so it gets `CSP: sandbox`. */
const SAFE_TYPE =
  /^(image\/(png|jpeg|gif|webp|avif|bmp|heic|heif|tiff)|application\/pdf|text\/plain)$/;
const THUMB_MAX_AGE = 31_536_000;
/** Vite puts a hash of the content in these names, so a name never changes meaning. */
const ASSET_CACHE = `private, max-age=${THUMB_MAX_AGE}, immutable`;

/**
 * The built UI, the one place that knows where it lands: `dist/web` from source, and beside a
 * bundle, which may be a chunk in `dist/` or `dist/server/start.mjs`, inside an asar or not.
 */
export function webRoot(): string | undefined {
  const fromSource = import.meta.url.endsWith('.ts');
  return (fromSource ? ['../../dist/web'] : ['./web', '../web'])
    .map((dir) => fileURLToPath(new URL(`${dir}/`, import.meta.url)))
    .find((dir) => existsSync(`${dir}index.html`));
}

/** A byte range, or null when the header cannot be met. Several ranges get the whole file. */
export function parseRange(header: string | undefined, size: number) {
  const whole = { start: 0, end: size - 1, partial: false };
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return whole;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  const start = first === '' ? Math.max(size - Number(last), 0) : Number(first);
  const end = first === '' || last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return start > end || start >= size ? null : { start, end, partial: true };
}

/** Streams an original. Refuses anything but a regular file at read time, links included. */
async function sendFile(c: HonoContext, path: string, mime: string | null): Promise<Response> {
  if (!(await lstat(path).catch(() => undefined))?.isFile()) return c.text('Not found', 404);
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return c.text('Not found', 404); // it turned into a link after the `lstat`
  }
  const { size } = await handle.stat();
  const type = mime ?? 'application/octet-stream';
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-type': type,
  });
  if (!SAFE_TYPE.test(type)) headers.set('content-security-policy', 'sandbox');
  const range = parseRange(c.req.header('range'), size);
  if (!range) {
    await handle.close();
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-length', String(size === 0 ? 0 : range.end - range.start + 1));
  if (size === 0) {
    await handle.close();
    return new Response(null, { status: 200, headers });
  }
  if (range.partial) headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  const stream = handle.createReadStream({ start: range.start, end: range.end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range.partial ? 206 : 200,
    headers,
  });
}

const fileId = (c: HonoContext) => {
  const text = c.req.param('id') ?? '';
  return /^\d+$/.test(text) ? Number(text) : 0;
};

/** Reports a failure. A `UserError` is the person's to fix, and anything else is a bug. */
function failure(c: HonoContext, error: unknown): Response {
  if (error instanceof UserError) return c.json({ ok: false, error: error.message }, 400);
  console.error(sanitize(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  return c.json({ ok: false, error: 'Internal error' }, 500);
}

/** The routes that serve a file's bytes or thumbnail, by id. */
function addFileRoutes(app: Hono, ctx: Context): void {
  app.get('/thumb/:id', async (c) => {
    const size = c.req.query('size') === '1024' ? 1024 : 256;
    const path = await thumbnailFile(ctx, fileId(c), size);
    if (!path) return c.text('Not found', 404);
    return new Response(await readFile(path), {
      headers: {
        'content-type': 'image/webp',
        'cache-control': `private, max-age=${THUMB_MAX_AGE}, immutable`,
      },
    });
  });

  app.get('/file/:id', async (c) => {
    const file = servableFile(ctx, fileId(c));
    return file ? sendFile(c, file.path, file.mime) : c.text('Not found', 404);
  });
}

function addUiRoutes(app: Hono): void {
  const root = webRoot();
  if (root) {
    app.use('/assets/*', async (c, next) => {
      await next();
      // A name that does not exist falls through to index.html, which must stay fresh.
      if (!c.res.headers.get('content-type')?.startsWith('text/html')) {
        c.res.headers.set('cache-control', ASSET_CACHE);
      }
    });
    app.use('*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' })); // the UI routes on the client
  } else {
    app.get('*', (c) => c.text('The UI is not built. Run: pnpm build', 404));
  }
}

/** Builds the app for one launch. `ctx.emit` should feed the returned `publish`. */
export function createApp(ctx: Context, port: number, token: string) {
  const listeners = new Set<(event: ServerEvent) => void>();
  const app = new Hono();

  app.use(async (c, next) => {
    await next();
    c.res.headers.set('x-content-type-options', 'nosniff');
    if (!c.res.headers.has('content-security-policy')) {
      c.res.headers.set('content-security-policy', CSP);
    }
  });
  app.use(guard(port, token));

  app.get('/auth', (c) => {
    setCookie(c, cookieName(port), token, { httpOnly: true, sameSite: 'Strict', path: '/' });
    return c.redirect('/');
  });

  app.post('/api/call/:tool', async (c) => {
    const name = c.req.param('tool');
    if (!isToolName(name)) return c.json({ ok: false, error: `No tool named ${name}` }, 404);
    try {
      const input: unknown = await c.req.json().catch(() => {
        throw new UserError('The request body is not JSON');
      });
      const data = await callTool(name, input as never, { ...ctx, caller: 'ui' });
      return c.json({ ok: true, data });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: ServerEvent) => void stream.writeSSE({ data: JSON.stringify(event) });
      listeners.add(send);
      await new Promise<void>((done) => {
        stream.onAbort(done);
      });
      listeners.delete(send);
    }),
  );

  app.post('/api/chat', async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as { messages?: unknown } | null;
      if (!Array.isArray(body?.messages)) throw new UserError('messages is required');
      return await chat(body.messages, { ...ctx, caller: 'chat' as const }, tools);
    } catch (error) {
      return failure(c, error);
    }
  });

  addFileRoutes(app, ctx);
  addUiRoutes(app);

  return { app, publish: (event: ServerEvent) => listeners.forEach((send) => send(event)) };
}
