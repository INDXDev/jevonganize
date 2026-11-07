/** The real server the web tests drive: the built CLI on a fresh, temporary home. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/** A running server: the URL that signs a page in, and how to stop it and remove its home. */
export type TestServer = { authUrl: string; stop: () => Promise<void> };

/** Starts the server in English. It takes the next free port, so test files never collide. */
export async function startServer(): Promise<TestServer> {
  const home = await mkdtemp(join(tmpdir(), 'jevonganize-e2e-'));
  await mkdir(join(home, 'config'));
  await writeFile(join(home, 'config', 'config.toml'), 'language = "en"\n');
  const server = spawn('node', ['dist/cli.mjs', '--port', '4173', '--no-open'], {
    env: { ...process.env, JEVONGANIZE_HOME: home },
  });
  // The token is made at launch, so the printed URL is the only way in.
  const authUrl = await new Promise<string>((resolve, reject) => {
    server.stdout?.on('data', (data: Buffer) => {
      const found = /http:\S+/.exec(String(data));
      if (found) resolve(found[0]);
    });
    server.once('exit', () => reject(new Error('server exited')));
  });
  const stop = async () => {
    if (server.exitCode === null) {
      const exited = new Promise((done) => server.once('exit', done));
      server.kill();
      await exited;
    }
    // Windows releases the index's files a moment after the process ends.
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return { authUrl, stop };
}

/** Signs `page` in and pins English, as an earlier test may have saved another language. */
export async function signInEnglish(page: Page, authUrl: string) {
  await page.goto(authUrl);
  await page.evaluate(() =>
    fetch('/api/call/set_config', { method: 'POST', body: JSON.stringify({ language: 'en' }) }),
  );
  await page.reload();
}

/** Calls a tool through the page, as the UI does, and returns its data or throws its error. */
export async function callTool<T = unknown>(page: Page, tool: string, input: object): Promise<T> {
  const envelope = await page.evaluate(
    async ([name, body]) => {
      const response = await fetch(`/api/call/${name}`, { method: 'POST', body });
      return (await response.json()) as { ok: boolean; data?: unknown; error?: string };
    },
    [tool, JSON.stringify(input)] as const,
  );
  if (!envelope.ok) throw new Error(envelope.error);
  return envelope.data as T;
}
