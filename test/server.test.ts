import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { callTool, type Context, openContext, waitForJob } from '../src/core/tools.ts';
import { createApp, parseRange, webRoot } from '../src/server/app.ts';
import { cookieName } from '../src/server/guard.ts';
import { startServer } from '../src/server/start.ts';
import { useTempHome } from './helpers.ts';

const PORT = 48999;
const TOKEN = 't'.repeat(64);
const HOST = `127.0.0.1:${PORT}`;

const home = useTempHome();
let ctx: Context;
let root: string;
let server: ReturnType<typeof createApp>;

const send = (
  path: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
) =>
  server.app.request(`http://${HOST}${path}`, {
    ...init,
    headers: { host: HOST, cookie: `${cookieName(PORT)}=${TOKEN}`, ...init.headers },
  });

const tool = (name: string, input: unknown = {}) =>
  send(`/api/call/${name}`, { method: 'POST', body: JSON.stringify(input) });

async function indexed(name: string, content: string | Uint8Array): Promise<number> {
  await writeFile(join(root, name), content);
  await waitForJob((await callTool('scan', {}, ctx)).id);
  return ctx.db.fileByPath(join(root, name))!.id;
}

beforeEach(async () => {
  root = join(home(), 'library');
  await mkdir(root);
  ctx = await openContext('ui');
  await callTool('add_library', { path: root }, ctx);
  server = createApp(ctx, PORT, TOKEN);
});

afterEach(() => ctx.db.close());

describe('/auth', () => {
  test('sets the session cookie and redirects, dropping the token from the address bar', async () => {
    const response = await server.app.request(`http://${HOST}/auth?t=${TOKEN}`, {
      headers: { host: HOST },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${cookieName(PORT)}=${TOKEN}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  test('every route sits behind the guard', async () => {
    for (const path of ['/', '/api/events', '/thumb/1', '/file/1', '/index.html']) {
      const response = await server.app.request(`http://${HOST}${path}`, {
        headers: { host: HOST },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });
});

describe('/api/call/:tool', () => {
  test('returns { ok, data }', async () => {
    const response = await tool('list_libraries');
    expect(await response.json()).toMatchObject({ ok: true, data: [{ path: root }] });
  });

  test('a UserError is 400 with its message', async () => {
    const response = await tool('get_plan', { id: 'none' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'There is no plan none' });
  });

  test('bad input and bad JSON are 400, and an unknown tool is 404', async () => {
    expect((await tool('get_plan', { id: 1 })).status).toBe(400);
    const broken = await send('/api/call/status', { method: 'POST', body: '{' });
    expect(broken.status).toBe(400);
    expect((await tool('constructor')).status).toBe(404);
  });

  test('anything else is 500, logged, and tells the client nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.db.close();
    const response = await tool('list_libraries');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'Internal error' });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    ctx = await openContext('ui');
  });

  test('plans made here are the user’s', async () => {
    const id = await indexed('a.txt', 'x');
    const response = await tool('propose_changes', { file_ids: [id], add: ['x'], title: 't' });
    expect(await response.json()).toMatchObject({ data: { source: 'user' } });
  });
});

describe('/api/events', () => {
  test('streams published events as plain SSE messages', async () => {
    const response = await send('/api/events');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    await new Promise((done) => setTimeout(done, 10));
    server.publish({ type: 'reviews', count: 3 });
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('data: {"type":"reviews","count":3}');
    await reader.cancel();
  });
});

describe('/api/chat', () => {
  const body = { messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] };

  test('no key is a 400, not a stream', async () => {
    const response = await send('/api/chat', { method: 'POST', body: JSON.stringify(body) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('API key') });
  });

  test('refuses a body with no messages', async () => {
    const response = await send('/api/chat', { method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
  });
});

describe('/file/:id', () => {
  test('sends bytes with nosniff and no-store, and no sandbox on a safe type', async () => {
    const id = await indexed('a.txt', 'hello');
    const response = await send(`/file/${id}`);
    expect(await response.text()).toBe('hello');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-security-policy')).not.toBe('sandbox');
  });

  test.each(['a.html', 'a.svg', 'a.xml', 'a.js', 'a.unknownext'])('sandboxes %s', async (name) => {
    const id = await indexed(name, '<script>alert(1)</script>');
    expect((await send(`/file/${id}`)).headers.get('content-security-policy')).toBe('sandbox');
  });

  test('serves ranges, and answers 416 past the end', async () => {
    const id = await indexed('a.txt', '0123456789');
    const part = await send(`/file/${id}`, { headers: { range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('234');
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(part.headers.get('content-length')).toBe('3');
    const tail = await send(`/file/${id}`, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    const past = await send(`/file/${id}`, { headers: { range: 'bytes=20-' } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */10');
  });

  test('an empty file is fine', async () => {
    const id = await indexed('a.txt', '');
    const response = await send(`/file/${id}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});

describe('/file/:id refusals', () => {
  test('refuses an id not in the index, and anything that is not a plain id', async () => {
    expect((await send('/file/999')).status).toBe(404);
    expect((await send('/file/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await send('/file/1e0')).status).toBe(404);
  });

  test('refuses a file that became a link', async () => {
    const id = await indexed('a.txt', 'x');
    const { rm } = await import('node:fs/promises');
    await rm(join(root, 'a.txt'));
    await writeFile(join(home(), 'outside.txt'), 'private');
    await symlink(join(home(), 'outside.txt'), join(root, 'a.txt'));
    expect((await send(`/file/${id}`)).status).toBe(404);
  });

  test('refuses a file outside any current library, or now excluded', async () => {
    const id = await indexed('a.txt', 'x');
    ctx.config.exclude.push('a.txt');
    expect((await send(`/file/${id}`)).status).toBe(404);
    ctx.config.exclude.pop();
    ctx.db.moveFile(id, join(home(), 'elsewhere.txt'));
    expect((await send(`/file/${id}`)).status).toBe(404);
  });
});

describe('/thumb/:id', { timeout: 35_000 }, () => {
  test('serves a cached webp, immutable', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const id = await indexed('a.png', png);
    const response = await send(`/thumb/${id}?size=256&v=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  test('is 404 for a file with no thumbnail, or an unknown one', async () => {
    const id = await indexed('a.bin', Buffer.from([0, 1, 2, 3, 255]));
    expect((await send(`/thumb/${id}`)).status).toBe(404);
    expect((await send('/thumb/999')).status).toBe(404);
  });
});

describe('the UI', () => {
  test('carries the documented CSP', async () => {
    const { headers } = await send('/some/client/route');
    expect(headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  test.runIf(webRoot())('lets a hashed asset be cached for good, and nothing else', async () => {
    const [name] = (await readdir(join(webRoot()!, 'assets'))).filter((n) => n.endsWith('.js'));
    const asset = await send(`/assets/${name}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await send('/')).headers.get('cache-control')).toBeNull();
    // The UI answers for a name that does not exist, and that answer must not stick.
    expect((await send('/assets/gone.js')).headers.get('cache-control')).toBeNull();
  });

  test('webRoot looks in dist/web from source', () => {
    const web = webRoot();
    // A Windows path uses backslashes. This only passed there because the build used to lose dist/web.
    expect(web === undefined || web.replaceAll('\\', '/').endsWith('dist/web/')).toBe(true);
  });
});

test('parseRange covers the forms a browser sends', () => {
  expect(parseRange(undefined, 10)).toEqual({ start: 0, end: 9, partial: false });
  expect(parseRange('bytes=0-', 10)).toEqual({ start: 0, end: 9, partial: true });
  expect(parseRange('bytes=8-99', 10)).toEqual({ start: 8, end: 9, partial: true });
  expect(parseRange('bytes=-99', 10)).toEqual({ start: 0, end: 9, partial: true });
  expect(parseRange('bytes=5-2', 10)).toBeNull();
  expect(parseRange('bytes=-', 10)).toBeNull();
  expect(parseRange('bytes=0-1,3-4', 10)).toEqual({ start: 0, end: 9, partial: false });
});

describe('startServer', () => {
  test('under a parent port it posts { port, token } and opens no browser', async () => {
    await callTool('set_config', { port: 48722, watch: { enabled: false } }, ctx);
    const preload =
      'data:text/javascript,process.parentPort={postMessage(m){console.log(JSON.stringify(m))}}';
    const start = fileURLToPath(new URL('../src/server/start.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', preload, start], {
      env: { ...process.env, JEVONGANIZE_HOME: home() },
    });
    const message = await new Promise<{ port: number; token: string }>((done) => {
      child.stdout.once('data', (chunk) => {
        done(JSON.parse(String(chunk)) as { port: number; token: string });
      });
    });
    child.kill();
    await once(child, 'close'); // on Windows a live process keeps the temp home from being deleted
    expect(message.port).toBe(48722);
    expect(message.token).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  test('binds 127.0.0.1, moves on from a taken port, and serves with a real socket', async () => {
    await callTool('set_config', { port: 48711, watch: { enabled: false } }, ctx);
    const first = await startServer();
    const second = await startServer();
    try {
      expect(first.port).toBe(48711);
      expect(second.port).toBeGreaterThan(first.port);
      const auth = await fetch(first.url, { redirect: 'manual' });
      expect(auth.status).toBe(302);
      const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? '';
      const response = await fetch(`http://127.0.0.1:${first.port}/api/call/status`, {
        method: 'POST',
        headers: { cookie },
        body: '{}',
      });
      expect(await response.json()).toMatchObject({ ok: true });
      const token = await fetch(`http://localhost:${second.port}/api/call/status`, {
        method: 'POST',
        headers: { authorization: `Bearer ${second.token}` },
        body: '{}',
      });
      expect(token.status).toBe(200);
      await expect(startServer({ port: first.port })).rejects.toThrow('in use');
    } finally {
      await first.stop();
      await second.stop();
    }
  });
});
