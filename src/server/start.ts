/** Listens on 127.0.0.1 for the CLI and the desktop shell. */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createAdaptorServer } from '@hono/node-server';
import open from 'open';
import { UserError } from '../core/config.ts';
import { openContext, watchLibraries } from '../core/tools.ts';
import type { ServerEvent } from '../types.ts';
import { createApp } from './app.ts';

const PORT_TRIES = 20;

/** Set by Electron in a `utilityProcess`, and absent in plain Node. */
const parentPort = (process as { parentPort?: { postMessage(message: unknown): void } }).parentPort;

function listenOn(server: Server, port: number): Promise<boolean> {
  return new Promise((done, fail) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE') done(false);
      else fail(error);
    };
    const onListening = () => {
      server.off('error', onError);
      done(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/** Takes `wanted`, or with `strict` off the next free port after it. */
async function bind(server: Server, wanted: number, strict: boolean): Promise<number> {
  for (let port = wanted; port < wanted + (strict ? 1 : PORT_TRIES); port++) {
    if (await listenOn(server, port)) return port;
  }
  throw new UserError(`Port ${wanted} is in use`);
}

/** A running server. The URL holds the session token, so treat it as a password. */
export interface Running {
  url: string;
  port: number;
  token: string;
  stop(): Promise<void>;
}

/** Starts the server. An explicit `port` is taken or refused, and the config's may move on. */
export async function startServer(options: { port?: number; browser?: boolean } = {}) {
  let publish: ((event: ServerEvent) => void) | undefined;
  const ctx = await openContext('ui', (event) => publish?.(event));
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  const server = createAdaptorServer({
    fetch: (request: Request) => handler?.(request) ?? new Response(null, { status: 503 }),
  }) as Server;
  const port = await bind(
    server,
    options.port ?? ctx.config.port,
    options.port !== undefined,
  ).catch((error: unknown) => {
    ctx.db.close();
    throw error;
  });
  const token = randomBytes(32).toString('hex');
  const created = createApp(ctx, port, token);
  publish = created.publish;
  handler = (request) => created.app.fetch(request);

  const stopWatching = ctx.config.watch.enabled ? watchLibraries(ctx) : async () => {};
  const url = `http://127.0.0.1:${port}/auth?t=${token}`;
  if (options.browser) await open(url);

  const stop = async () => {
    await stopWatching();
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections(); // `/api/events` would hold it open
    });
    ctx.db.close();
  };
  return { url, port, token, stop } satisfies Running;
}

if (parentPort) {
  const { port, token } = await startServer();
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Electron's port, not a window
  parentPort.postMessage({ port, token });
}
