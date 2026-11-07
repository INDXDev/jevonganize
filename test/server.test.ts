import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { webRoot } from '../src/server/app.ts';
import { parseRange } from '../src/server/files.ts';
import { cookieName } from '../src/server/guard.ts';
import {
  ctx,
  HOST,
  indexed,
  PORT,
  reopenContext,
  root,
  send,
  sendSignedOut,
  server,
  setupServer,
  tool,
  TOKEN,
} from './server-helpers.ts';

setupServer();

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

  test.each(['/', '/api/events', '/thumb/1', '/file/1', '/index.html'])(
    '%s sits behind the guard',
    async (path) => {
      const response = await sendSignedOut(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    },
  );
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

  test('bad input and bad JSON are 400', async () => {
    expect((await tool('get_plan', { id: 1 })).status).toBe(400);
    const broken = await send('/api/call/status', { method: 'POST', body: '{' });
    expect(broken.status).toBe(400);
  });

  test('an unknown tool is 404, even a name every object has', async () => {
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
    await reopenContext();
  });

  test('plans made here are the user’s', async () => {
    const id = await indexed('a.txt', 'x');
    const response = await tool('propose_changes', { file_ids: [id], add: ['x'], title: 't' });
    expect(await response.json()).toMatchObject({ data: { source: 'user' } });
  });
});

test('/api/events streams published events as plain SSE messages', async () => {
  const response = await send('/api/events');
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  await new Promise((done) => setTimeout(done, 10));

  server.publish({ type: 'reviews', count: 3 });

  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain('data: {"type":"reviews","count":3}');
  await reader.cancel();
});

describe('/api/chat', () => {
  const hello = { messages: [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] };

  test('no key is a 400, not a stream', async () => {
    const response = await send('/api/chat', { method: 'POST', body: JSON.stringify(hello) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('API key') });
  });

  test('refuses a body with no messages', async () => {
    const response = await send('/api/chat', { method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
  });
});

describe('the UI', () => {
  test('carries the documented CSP', async () => {
    const { headers } = await send('/some/client/route');
    expect(headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  test.runIf(webRoot())('lets a hashed asset be cached for good, and nothing else', async () => {
    const assets = await readdir(join(webRoot()!, 'assets'));
    const script = assets.find((name) => name.endsWith('.js'));
    const asset = await send(`/assets/${script}`);
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

describe('parseRange', () => {
  const whole = { start: 0, end: 9, partial: false };

  test('no header, or several ranges, is the whole file', () => {
    expect(parseRange(undefined, 10)).toEqual(whole);
    expect(parseRange('bytes=0-1,3-4', 10)).toEqual(whole);
  });

  test('an open or overlong range is cut at the end of the file', () => {
    expect(parseRange('bytes=0-', 10)).toEqual({ start: 0, end: 9, partial: true });
    expect(parseRange('bytes=8-99', 10)).toEqual({ start: 8, end: 9, partial: true });
    expect(parseRange('bytes=-99', 10)).toEqual({ start: 0, end: 9, partial: true });
  });

  test('a backwards or empty range is refused', () => {
    expect(parseRange('bytes=5-2', 10)).toBeNull();
    expect(parseRange('bytes=-', 10)).toBeNull();
  });
});
