/** The routes. The tool table is the API, so nothing here does the work itself. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context as HonoContext, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { chat } from '../ai/chat.ts';
import { UserError } from '../core/config.ts';
import { sanitize } from '../core/sanitize.ts';
import { callTool, type Context, isToolName, tools } from '../core/tools.ts';
import { usageRecorder } from '../core/usage.ts';
import type { ServerEvent } from '../types.ts';
import { addFileRoutes, ONE_YEAR_SECONDS } from './files.ts';
import { cookieName, guard } from './guard.ts';

const CSP =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
/** Vite puts a hash of the content in these names, so a name never changes meaning. */
const ASSET_CACHE = `private, max-age=${ONE_YEAR_SECONDS}, immutable`;

type Listener = (event: ServerEvent) => void;

/**
 * The built UI, the one place that knows where it lands: `dist/web` from source, and beside a
 * bundle, which may be a chunk in `dist/` or `dist/server/start.mjs`, inside an asar or not.
 */
export function webRoot(): string | undefined {
  const isFromSource = import.meta.url.endsWith('.ts');
  const candidates = isFromSource ? ['../../dist/web'] : ['./web', '../web'];
  return candidates
    .map((dir) => fileURLToPath(new URL(`${dir}/`, import.meta.url)))
    .find((dir) => existsSync(`${dir}index.html`));
}

/** Reports a failure. A `UserError` is the person's to fix, and anything else is a bug. */
function failure(c: HonoContext, error: unknown): Response {
  if (error instanceof UserError) return c.json({ ok: false, error: error.message }, 400);
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(sanitize(detail));
  return c.json({ ok: false, error: 'Internal error' }, 500);
}

/** `nosniff` on everything, and the strict CSP wherever a route has not set a stricter one. */
function addSecurityHeaders(app: Hono): void {
  app.use(async (c, next) => {
    await next();
    c.res.headers.set('x-content-type-options', 'nosniff');
    if (!c.res.headers.has('content-security-policy')) {
      c.res.headers.set('content-security-policy', CSP);
    }
  });
}

async function jsonBody(c: HonoContext): Promise<unknown> {
  return c.req.json().catch(() => {
    throw new UserError('The request body is not JSON');
  });
}

/** `/api/call/:tool`, `/api/events` and `/api/chat`. */
function addApiRoutes(app: Hono, ctx: Context, listeners: Set<Listener>): void {
  app.post('/api/call/:tool', async (c) => {
    const name = c.req.param('tool');
    if (!isToolName(name)) return c.json({ ok: false, error: `No tool named ${name}` }, 404);
    try {
      const input = await jsonBody(c);
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
      const chatCtx = { ...ctx, caller: 'chat' as const };
      return await chat(body.messages, chatCtx, tools, usageRecorder(ctx.db, 'chat'));
    } catch (error) {
      return failure(c, error);
    }
  });
}

function addUiRoutes(app: Hono): void {
  const root = webRoot();
  if (!root) {
    app.get('*', (c) => c.text('The UI is not built. Run: pnpm build', 404));
    return;
  }
  app.use('/assets/*', async (c, next) => {
    await next();
    // A name that does not exist falls through to index.html, which must stay fresh.
    if (!c.res.headers.get('content-type')?.startsWith('text/html')) {
      c.res.headers.set('cache-control', ASSET_CACHE);
    }
  });
  app.use('*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' })); // the UI routes on the client
}

/** Builds the app for one launch. `ctx.emit` should feed the returned `publish`. */
export function createApp(ctx: Context, port: number, token: string) {
  const listeners = new Set<Listener>();
  const app = new Hono();
  addSecurityHeaders(app);
  app.use(guard(port, token));
  app.get('/auth', (c) => {
    setCookie(c, cookieName(port), token, { httpOnly: true, sameSite: 'Strict', path: '/' });
    return c.redirect('/');
  });
  addApiRoutes(app, ctx, listeners);
  addFileRoutes(app, ctx);
  addUiRoutes(app);
  return { app, publish: (event: ServerEvent) => listeners.forEach((send) => send(event)) };
}
