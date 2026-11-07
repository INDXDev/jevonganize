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

    const organized = await cli(['organize', root, '--facets', 'doc-type', '--no-apply']);
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

  test('organize applies by default, and undo takes the tags back', async () => {
    const path = join(root, 'invoice.txt');
    await writeFile(path, 'Invoice 44');
    await cli(['scan', root]);
    const { stdout } = await cli(['organize', root, '--facets', 'doc-type']);
    expect(await readTags(path)).toEqual(['doc-type:invoice']);
    const id = /undo ([0-9a-f]{8})/.exec(stdout)?.[1] ?? '';
    await cli(['undo', id]);
    expect(await readTags(path)).toEqual([]);
  });

  test('--json is NDJSON with plan_id last, applying appends the apply job, and answers are cached', async () => {
    const path = join(root, 'invoice.txt');
    await writeFile(path, 'Invoice 44');
    await cli(['scan', root]);
    const { stdout } = await cli([
      'organize',
      root,
      '--facets',
      'doc-type',
      '--no-apply',
      '--json',
    ]);
    const organizeJob = ndjson<Job>(stdout).at(-1);
    expect(organizeJob).toMatchObject({ kind: 'organize', status: 'done' });
    expect(organizeJob?.plan_id).toBeTruthy();
    const dry = await cli(['organize', root, '--facets', 'doc-type', '--dry-run', '--json']);
    expect(JSON.parse(dry.stdout)).toMatchObject<Partial<Estimate>>({ cached: 1 });

    const applied = await cli(['organize', root, '--facets', 'doc-type', '--json']);
    const jobs = ndjson<Job>(applied.stdout);
    expect(jobs.at(-1)).toMatchObject({ kind: 'apply', status: 'done' });
    expect(requests).toHaveLength(1);
    expect(await readTags(path)).toEqual(['doc-type:invoice']);
  });
});

/** Every sweep question picks its first option, and every topic is then confirmed. */
function answerTopics() {
  stub.removeAllListeners('request');
  stub.on('request', (request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += String(chunk)));
    request.on('end', () => {
      const { questions } = JSON.parse(body) as {
        questions: Record<string, { type: string; criteria: object }>;
      };
      const answers = Object.entries(questions).map(([id, { type, criteria }]) => {
        if (type === 'noul') return [id, { type, noul: 0.99 }];
        const odds = Object.keys(criteria).map((option) => [option, option === 'c0' ? 1 : 0]);
        return [id, { type, choice: 'c0', probabilities: Object.fromEntries(odds) }];
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ answers: Object.fromEntries(answers) }));
    });
  });
}

describe('topics against a stub provider', () => {
  test('topics pick starts from an unknown folder, and --dry-run adds nothing', async () => {
    answerTopics();
    await writeFile(join(root, 'budget-2026.xlsx'), 'x');
    const { code, stdout } = await cli(['topics', 'pick', root, '--dry-run', '--limit', '3']);
    expect(code).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(3);
    const again = await cli(['topics', 'pick', root, '--limit', '3']);
    expect(again.stdout).toBe(stdout);
    const next = await cli(['topics', 'pick', root, '--limit', '3']);
    expect(next.stdout).not.toBe(stdout); // the first three are active now, so they are not offered
  });

  test('setup chooses topics at first start, and skips names with no [ner] key', async () => {
    answerTopics();
    await writeFile(join(root, 'budget-2026.xlsx'), 'x');
    const { code, stderr } = await cli(['setup', '--yes', '--folder', root, '--topics']);
    expect(code).toBe(0);
    expect(stderr).toContain('100 topics from 1 file names');
  });

  test('setup --yes alone sends nothing', async () => {
    answerTopics();
    await writeFile(join(root, 'a.txt'), 'x');
    expect((await cli(['setup', '--yes', '--folder', root])).code).toBe(0);
    expect(requests).toEqual([]);
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
    await cli(['config', 'set', 'thresholds.apply', '0.85']);
    await cli(['organize', root, '--facets', 'doc-type']);
    const listed = await cli(['review']);
    expect(listed.stdout).toContain('doc-type:invoice (1)');
    const accepted = await cli(['review', '--tag', 'doc-type:invoice', '--accept', 'all']);
    expect(accepted.stdout).toBe('Accepted 1 items.\n');
    expect(await readTags(path)).toEqual(['doc-type:invoice']);
  });
});
