import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { cookieName, guard, sameToken } from '../src/server/guard.ts';

const PORT = 48620;
const TOKEN = 'a'.repeat(64);
const HOST = `127.0.0.1:${PORT}`;
const COOKIE = `${cookieName(PORT)}=${TOKEN}`;

const app = new Hono();
app.use(guard(PORT, TOKEN));
app.get('/auth', (c) => c.text('authed'));
app.all('*', (c) => c.text('reached'));

const request = (headers: Record<string, string>, path = '/api/call/status') =>
  app.request(`http://${HOST}${path}`, { headers });
const signedIn = (extra: Record<string, string> = {}) =>
  request({ host: HOST, cookie: COOKIE, ...extra });

const auth = (token: string, headers: Record<string, string> = {}) =>
  request({ host: HOST, ...headers }, `/auth?t=${token}`);

describe('Host', () => {
  test.each([HOST, `localhost:${PORT}`])('allows %s', async (host) => {
    expect((await request({ host, cookie: COOKIE })).status).toBe(200);
  });

  test.each([
    'evil.example',
    `evil.example:${PORT}`,
    '127.0.0.1',
    'localhost',
    '127.0.0.1:1',
    `[::1]:${PORT}`,
    `0.0.0.0:${PORT}`,
    `LOCALHOST:${PORT}`,
    `127.0.0.1:${PORT}.evil.example`,
    '',
  ])('refuses %j, even with the token', async (host) => {
    expect((await request({ host, cookie: COOKIE })).status).toBe(403);
  });

  test('refuses a request with no Host', async () => {
    const bare = new Request(`http://${HOST}/`, { headers: { cookie: COOKIE } });
    bare.headers.delete('host');
    expect((await app.fetch(bare)).status).toBe(403);
  });
});

describe('Origin', () => {
  test('passes when absent, or equal to http://<Host>', async () => {
    expect((await signedIn()).status).toBe(200);
    expect((await signedIn({ origin: `http://${HOST}` })).status).toBe(200);
    const local = `localhost:${PORT}`;
    const response = await request({ host: local, cookie: COOKIE, origin: `http://${local}` });
    expect(response.status).toBe(200);
  });

  test.each([
    'http://evil.example',
    'null',
    `https://${HOST}`,
    'http://127.0.0.1:1',
    `http://localhost:${PORT}`, // a different origin from the Host in use
    `http://${HOST}/`,
    '',
  ])('refuses %j, even with the token', async (origin) => {
    expect((await signedIn({ origin })).status).toBe(403);
  });
});

describe('Sec-Fetch-Site', () => {
  test.each(['same-origin', 'none'])('allows %s', async (site) => {
    expect((await signedIn({ 'sec-fetch-site': site })).status).toBe(200);
  });

  test.each(['same-site', 'cross-site', 'SAME-ORIGIN', ''])('refuses %j', async (site) => {
    expect((await signedIn({ 'sec-fetch-site': site })).status).toBe(403);
  });
});

describe('token', () => {
  test('refuses no token, and any token that is wrong', async () => {
    expect((await request({ host: HOST })).status).toBe(401);
    expect((await request({ host: HOST, cookie: `${cookieName(PORT)}=wrong` })).status).toBe(401);
    expect((await request({ host: HOST, authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await request({ host: HOST, authorization: TOKEN })).status).toBe(401);
    expect((await request({ host: HOST, authorization: `Basic ${TOKEN}` })).status).toBe(401);
  });

  test('takes the cookie or a bearer token', async () => {
    expect((await request({ host: HOST, cookie: COOKIE })).status).toBe(200);
    expect((await request({ host: HOST, authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });

  test('a cookie for another port does not count: cookies do not isolate ports', async () => {
    const other = `${cookieName(PORT + 1)}=${TOKEN}`;
    expect((await request({ host: HOST, cookie: other })).status).toBe(401);
    expect(cookieName(PORT)).toContain(String(PORT));
  });

  test('a token in the query counts only on /auth', async () => {
    expect((await request({ host: HOST }, `/api/call/status?t=${TOKEN}`)).status).toBe(401);
  });

  test('comparison handles any length', () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken('short', TOKEN)).toBe(false);
    expect(sameToken('', TOKEN)).toBe(false);
    expect(sameToken(undefined, TOKEN)).toBe(false);
  });
});

describe('/auth', () => {
  test('takes the right token, with no session', async () => {
    expect(await (await auth(TOKEN)).text()).toBe('authed');
  });

  test('refuses a wrong or missing token, and a valid session does not stand in', async () => {
    expect((await auth('wrong')).status).toBe(401);
    expect((await request({ host: HOST }, '/auth')).status).toBe(401);
    expect((await auth('wrong', { cookie: COOKIE })).status).toBe(401);
  });

  test('skips only the session check: every other layer still holds', async () => {
    expect((await auth(TOKEN, { host: 'evil.example' })).status).toBe(403);
    expect((await auth(TOKEN, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await auth(TOKEN, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});

test('layers run in order: a bad Host is 403 before a missing token is 401', async () => {
  expect((await request({ host: 'evil.example' })).status).toBe(403);
  expect((await request({ host: HOST, origin: 'http://evil.example' })).status).toBe(403);
  expect((await request({ host: HOST, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
});
