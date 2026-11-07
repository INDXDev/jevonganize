import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { startServer } from '../src/server/start.ts';
import { configurePort, freePort, holdFreeBlock, home, setupServer } from './server-helpers.ts';

setupServer();

/** What the server posts to the Electron main process once it listens. */
interface ReadyMessage {
  port: number;
  token: string;
}

/** A preload that stands in for Electron's `process.parentPort`, printing what is posted to it. */
const FAKE_PARENT_PORT =
  'data:text/javascript,process.parentPort={postMessage(m){console.log(JSON.stringify(m))}}';

const START = fileURLToPath(new URL('../src/server/start.ts', import.meta.url));

/** Runs the server entry as a child under a fake parent port, and returns its first message. */
async function firstMessageUnderParentPort(): Promise<ReadyMessage> {
  const child = spawn(process.execPath, ['--import', FAKE_PARENT_PORT, START], {
    env: { ...process.env, JEVONGANIZE_HOME: home() },
  });
  const [chunk] = (await once(child.stdout, 'data')) as [Buffer];
  child.kill();
  await once(child, 'close'); // on Windows a live process keeps the temp home from being deleted
  return JSON.parse(String(chunk)) as ReadyMessage;
}

/** A server that listens on a real socket. */
type Started = Awaited<ReturnType<typeof startServer>>;

/** Starts two servers on the configured free port, runs `check`, and stops both. */
async function withTwoServers(
  check: (first: Started, second: Started, wanted: number) => Promise<void>,
) {
  const wanted = await freePort();
  await configurePort(wanted);
  const first = await startServer();
  const second = await startServer();
  try {
    await check(first, second, wanted);
  } finally {
    await first.stop();
    await second.stop();
  }
}

/** Calls the status tool over a real socket. */
const postStatus = (url: string, headers: Record<string, string>) =>
  fetch(url, { method: 'POST', headers, body: '{}' });

test('under a parent port it posts { port, token } and opens no browser', async () => {
  await configurePort(48722);
  const message = await firstMessageUnderParentPort();
  expect(message.port).toBe(48722);
  expect(message.token).toMatch(/^[0-9a-f]{64}$/);
}, 30_000);

test('binds the configured port, and moves on when it is taken', async () => {
  await withTwoServers(async (first, second, wanted) => {
    expect(first.port).toBe(wanted);
    expect(second.port).toBeGreaterThan(first.port);
  });
});

test('serves over a real socket, after the auth redirect or with a bearer token', async () => {
  await withTwoServers(async (first, second) => {
    const auth = await fetch(first.url, { redirect: 'manual' });
    expect(auth.status).toBe(302);
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? '';
    const byCookie = await postStatus(`http://127.0.0.1:${first.port}/api/call/status`, { cookie });
    expect(await byCookie.json()).toMatchObject({ ok: true });

    const bearer = { authorization: `Bearer ${second.token}` };
    const byToken = await postStatus(`http://localhost:${second.port}/api/call/status`, bearer);
    expect(byToken.status).toBe(200);
  });
});

test('refuses a port asked for by name when it is in use', async () => {
  await withTwoServers(async (first) => {
    await expect(startServer({ port: first.port })).rejects.toThrow('in use');
  });
});

test('lets the system pick a port when the configured one and the next 19 are all taken', async () => {
  // A block of 20 this machine can hold, so the server finds every one of them taken.
  const block = await holdFreeBlock(20);
  try {
    await configurePort(block.base);
    const started = await startServer();
    try {
      expect(started.port < block.base || started.port >= block.base + 20).toBe(true);
      expect(started.port).toBeGreaterThan(0);
    } finally {
      await started.stop();
    }
    await expect(startServer({ port: block.base })).rejects.toThrow('in use');
  } finally {
    block.release();
  }
});
