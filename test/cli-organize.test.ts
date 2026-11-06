import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readTags } from '../src/core/tags.ts';
import type { Estimate, Job, Plan } from '../src/types.ts';
import { cli, home, ndjson, root, setupCliHome } from './cli-helpers.ts';

setupCliHome();

/** A provider's reply: `invoice` at `p`, with the complete distribution the SDK requires. */
function answerAll(body: string, p: number) {
  const { questions } = JSON.parse(body) as {
    questions: Record<string, { type: string; criteria: object }>;
  };
  return Object.fromEntries(
    Object.entries(questions).map(([id, { type, criteria }]) => {
      if (type === 'noul') return [id, { type, noul: 0.01 }];
      const rest = Object.keys(criteria).filter((label) => label !== 'invoice');
      const others = rest.map((label) => [label, (1 - p) / rest.length]);
      const probabilities = Object.fromEntries([['invoice', p], ...others]);
      return [id, { type: 'choice', choice: 'invoice', probabilities }];
    }),
  );
}

let stub: Server;
let requests: string[];

beforeEach(async () => {
  requests = [];
  stub = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += String(chunk)));
    request.on('end', () => {
      requests.push(body);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ answers: answerAll(body, 0.99), usage: { input_tokens: 10 } }));
    });
  });
  await new Promise<void>((done) => {
    stub.listen(0, '127.0.0.1', done);
  });
  const { port } = stub.address() as AddressInfo;
  await mkdir(join(home(), 'config'), { recursive: true });
  await writeFile(
    join(home(), 'config', 'config.toml'),
    `language = "en"\n[provider]\nname = "openrouter"\nmodel = "jev"\nbase_url = "http://127.0.0.1:${port}"\n`,
  );
  await cli(['auth', 'set', 'openrouter'], { stdin: 'test-key' });
});

afterEach(async () => {
  await new Promise((done) => {
    stub.close(done);
  });
});

describe('organize against a stub provider', () => {
  test('scan, organize, apply, undo, all through the real binary', async () => {
    const path = join(root, 'invoice.txt');
    await writeFile(path, 'Invoice 44');
    await cli(['scan', root]);

    const organized = await cli(['organize', root, '--facets', 'doc-type']);
    expect(organized.code).toBe(0);
    expect(organized.stderr).toContain('tokens');
    expect(organized.stdout).toContain('doc-type:invoice');
    expect(organized.stdout).toContain('Nothing was written.');
    expect(await readTags(path)).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('Invoice 44');
    expect(requests[0]).not.toContain(root); // the folder path stays here

    const id = /Plan ([0-9a-f]{8})/.exec(organized.stdout)?.[1] ?? '';
    const plan = JSON.parse((await cli(['plans', id, '--json'])).stdout) as Plan;
    expect(plan).toMatchObject({ source: 'organize', status: 'proposed' });
    await cli(['apply', id]);
    expect(await readTags(path)).toEqual(['doc-type:invoice']);
    await cli(['undo', id]);
    expect(await readTags(path)).toEqual([]);
  });

  test('--json is NDJSON with plan_id last, --apply appends the apply job, and answers are cached', async () => {
    const path = join(root, 'invoice.txt');
    await writeFile(path, 'Invoice 44');
    await cli(['scan', root]);
    const { stdout } = await cli(['organize', root, '--facets', 'doc-type', '--json']);
    const organizeJob = ndjson<Job>(stdout).at(-1);
    expect(organizeJob).toMatchObject({ kind: 'organize', status: 'done' });
    expect(organizeJob?.plan_id).toBeTruthy();
    const dry = await cli(['organize', root, '--facets', 'doc-type', '--dry-run', '--json']);
    expect(JSON.parse(dry.stdout)).toMatchObject<Partial<Estimate>>({ cached: 1 });

    const applied = await cli(['organize', root, '--facets', 'doc-type', '--apply', '--json']);
    const jobs = ndjson<Job>(applied.stdout);
    expect(jobs.at(-1)).toMatchObject({ kind: 'apply', status: 'done' });
    expect(requests).toHaveLength(1);
    expect(await readTags(path)).toEqual(['doc-type:invoice']);
  });
});

describe('organize against a stub provider: failures and review', () => {
  test('every file failing is exit 2', async () => {
    await writeFile(join(root, 'a.txt'), 'x');
    await cli(['scan', root]);
    stub.removeAllListeners('request');
    stub.on('request', (_request, response) => {
      response.statusCode = 400;
      response.end('no');
    });
    const { code, stderr } = await cli(['organize', root, '--facets', 'doc-type']);
    expect(code).toBe(2);
    expect(stderr).toContain('Every file failed');
  });

  test('a rejected key is exit 2, and nothing is stored as a plan', async () => {
    await writeFile(join(root, 'a.txt'), 'x');
    await cli(['scan', root]);
    stub.removeAllListeners('request');
    stub.on('request', (_request, response) => {
      response.statusCode = 401;
      response.end('no');
    });
    const { code, stderr } = await cli(['organize', root, '--facets', 'doc-type']);
    expect(code).toBe(2);
    expect(stderr).toContain('rejected the API key');
    expect((await cli(['plans'])).stdout).toBe('');
  });

  test('review accepts into tags, through a plan', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'x');
    await cli(['scan', root]);
    stub.removeAllListeners('request');
    stub.on('request', (request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ answers: answerAll(body, 0.6) }));
      });
    });
    await cli(['organize', root, '--facets', 'doc-type']);
    const listed = await cli(['review']);
    expect(listed.stdout).toContain('doc-type:invoice (1)');
    const accepted = await cli(['review', '--tag', 'doc-type:invoice', '--accept', 'all']);
    expect(accepted.stdout).toBe('Accepted 1 items.\n');
    expect(await readTags(path)).toEqual(['doc-type:invoice']);
  });
});
