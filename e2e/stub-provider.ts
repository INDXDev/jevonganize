/**
 * A stub model provider on localhost, so an end-to-end test can organize through the real server and
 * record real usage rows without calling any provider. It answers like the decision API that the
 * OpenRouter provider speaks, as test/cli-provider-helpers.ts does for the CLI.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { callTool } from './server.ts';

type Questions = Record<string, { type: string; criteria: object }>;

/** Picks every question's first option, surely, and reports a few input tokens. */
function answerFirst(body: string) {
  const { questions } = JSON.parse(body) as { questions: Questions };
  const answers = Object.entries(questions).map(([id, { type, criteria }]) => {
    if (type === 'noul') return [id, { type, noul: 0.01 }];
    const labels = Object.keys(criteria);
    const odds = labels.map((label, index) => [label, index === 0 ? 1 : 0]);
    return [id, { type: 'choice', choice: labels[0], probabilities: Object.fromEntries(odds) }];
  });
  return { answers: Object.fromEntries(answers), usage: { input_tokens: 10 } };
}

/** Starts the stub on a free port. Returns its base URL and a way to stop it. */
export async function startStubProvider(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += String(chunk)));
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(answerFirst(body)));
    });
  });
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((done) => {
      server.close(() => done());
    });
  return { url: `http://127.0.0.1:${port}`, close };
}

/** Waits until the server runs no job. */
export async function waitForJobs(page: Page): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    const status = await callTool<{ jobs: { status: string }[] }>(page, 'status', {});
    if (!status.jobs.some((job) => job.status === 'running')) return;
    await page.waitForTimeout(100);
  }
  throw new Error('a job is still running');
}
