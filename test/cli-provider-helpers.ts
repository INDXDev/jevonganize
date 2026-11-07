/** A stub model provider on localhost, for CLI tests that organize through the real binary. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach } from 'vitest';
import { cli, home } from './cli-helpers.ts';

/** The questions of one request to the provider, by id. */
type Questions = Record<string, { type: string; criteria: object }>;

/** Turns the body of a request into the JSON the stub replies with, or a status code to fail with. */
type Reply = (body: string) => object | number;

/** The stub of the running test: the bodies it has received, and a way to change its reply. */
export interface StubProvider {
  /** Every request body, in order. */
  requests: string[];
  /** Replaces the reply for the requests that follow. */
  replyWith(reply: Reply): void;
}

/** A provider's reply: `invoice` at `p`, with the complete distribution the SDK requires. */
export function answerInvoice(body: string, p: number) {
  const { questions } = JSON.parse(body) as { questions: Questions };
  const answers = Object.entries(questions).map(([id, { type, criteria }]) => {
    if (type === 'noul') return [id, { type, noul: 0.01 }];
    const rest = Object.keys(criteria).filter((label) => label !== 'invoice');
    const others = rest.map((label) => [label, (1 - p) / rest.length]);
    const probabilities = Object.fromEntries([['invoice', p], ...others]);
    return [id, { type: 'choice', choice: 'invoice', probabilities }];
  });
  return Object.fromEntries(answers);
}

/** A provider's reply where every sweep question picks its first option, and every topic is confirmed. */
export function answerFirstTopics(body: string) {
  const { questions } = JSON.parse(body) as { questions: Questions };
  const answers = Object.entries(questions).map(([id, { type, criteria }]) => {
    if (type === 'noul') return [id, { type, noul: 0.99 }];
    const odds = Object.keys(criteria).map((option) => [option, option === 'c0' ? 1 : 0]);
    return [id, { type, choice: 'c0', probabilities: Object.fromEntries(odds) }];
  });
  return { answers: Object.fromEntries(answers) };
}

/** The default reply: a sure `invoice`, with token usage. */
const sureInvoice: Reply = (body) => ({
  answers: answerInvoice(body, 0.99),
  usage: { input_tokens: 10 },
});

/** Sends what `reply` makes of the body: JSON, or a bare failure status. */
function respond(reply: Reply, body: string, response: ServerResponse) {
  const result = reply(body);
  if (typeof result === 'number') {
    response.statusCode = result;
    response.end('no');
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(result));
}

/**
 * Starts a stub provider before each test, with the config pointing OpenRouter at it and a key
 * stored. Call it after `setupCliHome`.
 */
export function useStubProvider(): StubProvider {
  let reply = sureInvoice;
  let server: Server;
  const stub: StubProvider = { requests: [], replyWith: (next) => (reply = next) };
  beforeEach(async () => {
    stub.requests = [];
    reply = sureInvoice;
    server = createServer((request: IncomingMessage, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        stub.requests.push(body);
        respond(reply, body, response);
      });
    });
    await new Promise<void>((done) => {
      server.listen(0, '127.0.0.1', done);
    });
    const { port } = server.address() as AddressInfo;
    const provider = `[provider]\nname = "openrouter"\nmodel = "jev"\nbase_url = "http://127.0.0.1:${port}"\n`;
    await writeFile(join(home(), 'config', 'config.toml'), `language = "en"\n${provider}`);
    await cli(['auth', 'set', 'openrouter'], { stdin: 'test-key' });
  });
  afterEach(async () => {
    await new Promise((done) => {
      server.close(done);
    });
  });
  return stub;
}
