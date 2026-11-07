/** Shared setup of the server tests: the app on a temp home with one library, and requests to it. */
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { callTool, type Context, openContext, waitForJob } from '../src/core/tools.ts';
import { createApp } from '../src/server/app.ts';
import { cookieName } from '../src/server/guard.ts';
import { useTempHome } from './helpers.ts';

/** The port the app believes it listens on. Requests go to the app in process, never to a socket. */
export const PORT = 48999;
/** The session token of the app. */
export const TOKEN = 't'.repeat(64);
/** The host header the guard accepts. */
export const HOST = `127.0.0.1:${PORT}`;

/** The context of the running test. */
export let ctx: Context;
/** The library of the running test. */
export let root: string;
/** The app of the running test. */
export let server: ReturnType<typeof createApp>;
/** The temp home of the running test. */
export let home: () => string;

/** Gives each test in the file a temp home, a UI context with one library, and an app on it. */
export function setupServer(): void {
  home = useTempHome();
  beforeEach(async () => {
    root = join(home(), 'library');
    await mkdir(root);
    ctx = await openContext('ui');
    await callTool('add_library', { path: root }, ctx);
    server = createApp(ctx, PORT, TOKEN);
  });
  afterEach(() => ctx.db.close());
}

/** Opens a fresh context for the end of a test that closed the database on purpose. */
export async function reopenContext(): Promise<void> {
  ctx = await openContext('ui');
}

/** Headers a request may add, merged over those of a signed-in browser. */
type RequestOptions = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

/** Sends a request as a signed-in browser: the right host and the session cookie. */
export const send = (path: string, init: RequestOptions = {}) =>
  server.app.request(`http://${HOST}${path}`, {
    ...init,
    headers: { host: HOST, cookie: `${cookieName(PORT)}=${TOKEN}`, ...init.headers },
  });

/** Sends a request with the right host and no session cookie. */
export const sendSignedOut = (path: string) =>
  server.app.request(`http://${HOST}${path}`, { headers: { host: HOST } });

/** Calls a tool through `/api/call`, as the UI does. */
export const tool = (name: string, input: unknown = {}) =>
  send(`/api/call/${name}`, { method: 'POST', body: JSON.stringify(input) });

/** Writes a file into the library, scans it in, and returns its index id. */
export async function indexed(name: string, content: string | Uint8Array): Promise<number> {
  await writeFile(join(root, name), content);
  await waitForJob((await callTool('scan', {}, ctx)).id);
  return ctx.db.fileByPath(join(root, name))!.id;
}

/** Points the config at a port, with the watcher off so a started server holds nothing else. */
export const configurePort = (port: number) =>
  callTool('set_config', { port, watch: { enabled: false } }, ctx);

/** A port this machine has free now: WSL or Docker may hold any fixed one. */
export async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as { port: number };
  await new Promise((done) => probe.close(done));
  return port;
}

/** Listens on a port of 127.0.0.1, or resolves undefined when it is taken. */
function hold(port: number): Promise<Server | undefined> {
  return new Promise((done) => {
    const socket = createServer();
    socket.once('error', () => done(undefined));
    socket.listen(port, '127.0.0.1', () => done(socket));
  });
}

/** Holds every port from `start` up to `start + size`, or releases them all when one is taken. */
async function holdBlockAt(start: number, size: number): Promise<Server[] | undefined> {
  const held: Server[] = [];
  for (let port = start; port < start + size; port++) {
    const socket = await hold(port);
    if (!socket) {
      for (const taken of held) taken.close();
      return undefined;
    }
    held.push(socket);
  }
  return held;
}

/** A block of ports this test holds, and how to let them go. */
export interface HeldBlock {
  base: number;
  release: () => void;
}

/** Finds and holds a block of `size` free ports between 41000 and 47000. */
export async function holdFreeBlock(size: number): Promise<HeldBlock> {
  for (let base = 41000; base < 47000; base += 200) {
    const held = await holdBlockAt(base, size);
    if (held) return { base, release: () => held.forEach((socket) => socket.close()) };
  }
  throw new Error(`no block of ${size} free ports between 41000 and 47000`);
}
