import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nodeSupported } from '../src/commands/floor.ts';
import { buildProgram } from '../src/commands/index.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import type { Estimate, Job, Plan } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

vi.setConfig({ testTimeout: 60_000 }); // each step spawns a real process

const home = useTempHome();
let root: string;

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the real CLI, async so a stub provider in this process can answer it. */
function cli(args: string[], options: { stdin?: string; env?: Record<string, string> } = {}) {
  return new Promise<Result>((done, fail) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, JEVONGANIZE_HOME: home(), NO_COLOR: '1', ...options.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', fail);
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end(options.stdin ?? '');
  });
}

const lines = (text: string) => text.trim().split('\n').filter(Boolean);
const ndjson = <T>(text: string) => lines(text).map((line) => JSON.parse(line) as T);

beforeEach(async () => {
  root = join(home(), 'library');
  await mkdir(root);
});

describe('the floor', () => {
  test.each([
    ['24.22.1', true],
    ['24.30.0', true],
    ['26.12.1', true],
    ['27.0.0', true],
    ['24.22.0', false],
    ['25.9.0', false],
    ['26.12.0', false],
    ['22.20.0', false],
  ])('%s: %s', (version, ok) => {
    expect(nodeSupported(version)).toBe(ok);
  });
});

describe('usage', () => {
  test('--version and --help print to stdout and exit 0', async () => {
    expect(await cli(['--version'])).toMatchObject({ code: 0, stdout: '0.1.0\n' });
    const help = await cli(['scan', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('--json');
  });

  test('an unknown flag or command is exit 2, and ends with a hint on stderr', async () => {
    const flag = await cli(['scan', '--nope']);
    expect(flag).toMatchObject({ code: 2, stdout: '' });
    expect(lines(flag.stderr).at(-1)).toBe('Run: jevonganize scan --help');
    const nested = await cli(['tags', 'list', '--nope']);
    expect(lines(nested.stderr).at(-1)).toBe('Run: jevonganize tags list --help');
    expect((await cli(['nonsense'])).code).toBe(2);
    expect((await cli(['tags'])).code).toBe(2);
  });

  test('--dry-run with --apply is a usage error', async () => {
    const { code, stderr } = await cli(['organize', root, '--dry-run', '--apply']);
    expect(code).toBe(2);
    expect(stderr).toContain('cannot be combined');
  });

  test('every documented command exists, with --json', async () => {
    const commands = [
      ['setup'],
      ['scan'],
      ['organize'],
      ['plans'],
      ['apply'],
      ['undo'],
      ['tags', 'list'],
      ['tags', 'add'],
      ['tags', 'remove'],
      ['tags', 'rename'],
      ['search'],
      ['show'],
      ['similar'],
      ['review'],
      ['suggest'],
      ['facets', 'list'],
      ['facets', 'show'],
      ['facets', 'enable'],
      ['facets', 'disable'],
      ['config', 'get'],
      ['config', 'set'],
      ['config', 'path'],
      ['config', 'edit'],
      ['auth', 'set'],
      ['auth', 'list'],
      ['auth', 'remove'],
      ['auth', 'env'],
      ['ask'],
      ['cleanup'],
      ['doctor'],
      ['mcp'],
    ];
    const missing = commands.filter((words) => {
      let found: Command | undefined = buildProgram();
      for (const word of words) found = found?.commands.find((entry) => entry.name() === word);
      return !found?.options.some((option) => option.long === '--json');
    });
    expect(missing).toEqual([]);
  });
});

describe('scan and read', () => {
  test('scan adds a library, reports on stdout, and --json is NDJSON ending in the final job', async () => {
    await writeFile(join(root, 'a.txt'), 'hello');
    await writeFile(join(root, '.env'), 'SECRET=1');
    const { code, stdout } = await cli(['scan', root]);
    expect(code).toBe(0);
    expect(stdout).toContain('1 files, 1 new, 0 changed.');
    expect(stdout).toContain('Skipped 1 by exclusion rules.');
    const again = await cli(['scan', root, '--json']);
    const jobs = ndjson<Job>(again.stdout);
    expect(jobs.at(-1)).toMatchObject({ kind: 'scan', status: 'done' });
  });

  // Windows refuses control characters in file names, so this name cannot exist there.
  test.skipIf(process.platform === 'win32')(
    'a hostile name is safe in text output, and kept in --json',
    async () => {
      const name = 'x\x1b]0;pwned\x07.txt';
      await writeFile(join(root, name), 'hello');
      await cli(['scan', root]);
      const text = await cli(['search', '--folder', root]);
      expect(text.stdout).not.toContain('\x1b');
      expect(text.stdout).toContain('x?]0;pwned?.txt');
      const json = await cli(['search', '--folder', root, '--json']);
      const { files } = JSON.parse(json.stdout) as { files: { name: string }[] };
      expect(files[0]?.name).toBe(name);
    },
  );

  test('a file not in the index suggests scan, and a plain id works', async () => {
    const miss = await cli(['show', join(root, 'none.txt')]);
    expect(miss.code).toBe(2);
    expect(miss.stderr).toContain('jevonganize scan');
    await writeFile(join(root, 'a.txt'), 'hello');
    await cli(['scan', root]);
    const shown = await cli(['show', '1']);
    expect(shown.stdout).toContain('(id 1)');
    expect((await cli(['similar', '1'])).code).toBe(0);
  });

  test('organize needs a library, and with no key refuses, and --dry-run needs none', async () => {
    const stray = await cli(['organize', root]);
    expect(stray).toMatchObject({ code: 2 });
    expect(stray.stderr).toContain('not in a library');
    await writeFile(join(root, 'a.txt'), 'hello');
    await cli(['scan', root]);
    const dry = await cli(['organize', root, '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('Nothing was sent.');
    const estimate = await cli(['organize', root, '--dry-run', '--json']);
    expect(JSON.parse(estimate.stdout)).toMatchObject({ files: 1, provider: 'openai' });
    const refused = await cli(['organize', root]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('nothing was sent');
  });
});

describe('tags', () => {
  test('add stores a plan and writes nothing until apply, and undo reverses it', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'hello');
    await cli(['scan', root]);
    const added = await cli(['tags', 'add', root, 'project:acme']);
    expect(added.stdout).toContain('1 files, 1 tags added, 0 removed');
    expect(added.stdout).toContain('Nothing was written.');
    expect(await readTags(path)).toEqual([]);
    const id = /Plan ([0-9a-f]{8})/.exec(added.stdout)?.[1] ?? '';

    const listed = await cli(['plans', '--status', 'proposed']);
    expect(listed.stdout).toContain(id);
    expect((await cli(['apply', id])).stdout).toContain(`Undo: jevonganize undo ${id}`);
    expect(await readTags(path)).toEqual(['project:acme']);
    expect((await cli(['undo', id])).stdout).toContain(`Undid ${id}: 1 files.`);
    expect(await readTags(path)).toEqual([]);
    expect((await cli(['apply', id])).code).toBe(2);
  });

  test('--apply goes at once, on a single file too, and rename follows', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'hello');
    await cli(['scan', root]);
    await cli(['tags', 'add', path, 'one', 'two', '--apply']);
    expect(await readTags(path)).toEqual(['one', 'two']);
    await cli(['tags', 'rename', 'one', 'uno', '--apply']);
    await cli(['tags', 'remove', root, 'two', '--apply']);
    expect(await readTags(path)).toEqual(['uno']);
    expect((await cli(['tags', 'list'])).stdout).toContain('uno');
  });

  test('query flags narrow the files', async () => {
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'b.txt'), 'b');
    await writeTags(join(root, 'a.txt'), ['doc-type:invoice']);
    await cli(['scan', root]);
    await cli(['tags', 'add', root, 'x', '--tag', 'doc-type:invoice', '--apply']);
    expect(await readTags(join(root, 'b.txt'))).toEqual([]);
    expect(await readTags(join(root, 'a.txt'))).toEqual(['doc-type:invoice', 'x']);
  });

  test('an invalid tag is refused with exit 2', async () => {
    await cli(['scan', root]);
    const { code, stderr } = await cli(['tags', 'add', root, 'a,b']);
    expect(code).toBe(2);
    expect(stderr).toContain('cannot contain');
  });

  test('apply exits 1 when an op fails, and the others stay applied', async () => {
    const { rm } = await import('node:fs/promises');
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'b.txt'), 'b');
    await cli(['scan', root]);
    const { stdout } = await cli(['tags', 'add', root, 'x']);
    await rm(join(root, 'a.txt'));
    const result = await cli(['apply', /Plan ([0-9a-f]{8})/.exec(stdout)?.[1] ?? '']);
    expect(result.code).toBe(1);
    expect(await readTags(join(root, 'b.txt'))).toEqual(['x']);
  });
});

describe('settings', () => {
  test('config set parses TOML, validates, and get reads it back', async () => {
    expect((await cli(['config', 'set', 'thresholds.apply', '0.9'])).stdout).toBe(
      'thresholds.apply = 0.9\n',
    );
    expect((await cli(['config', 'get', 'thresholds.apply'])).stdout).toBe('0.9\n');
    await cli(['config', 'set', 'exclude', '["a", "b"]']);
    expect((await cli(['config', 'get', 'exclude'])).stdout).toContain('"a"');
    expect((await cli(['config', 'set', 'nope', '1'])).code).toBe(2);
    expect((await cli(['config', 'get', 'nope'])).code).toBe(2);
    const json = JSON.parse((await cli(['config', 'get', '--json'])).stdout) as object;
    expect(json).toHaveProperty('schema');
  });

  test('config edit saves a valid file and never an invalid one', async () => {
    const script = join(home(), 'edit.mjs');
    const write = `import { writeFileSync as w } from 'node:fs'; w(process.argv[2], process.env.CONTENT);`;
    await writeFile(script, write);
    const editor = `${process.execPath} ${script}`; // Node, as Windows cannot run a shell script
    const good = await cli(['config', 'edit'], {
      env: { VISUAL: editor, CONTENT: 'concurrency = 3\n' },
    });
    expect(good.code).toBe(0);
    const bad = await cli(['config', 'edit'], { env: { VISUAL: editor, CONTENT: 'nope = 3\n' } });
    expect(bad.code).toBe(2);
    expect((await cli(['config', 'get', 'concurrency'])).stdout).toBe('3\n');
  });

  test('config path prints three paths inside the home', async () => {
    const paths = lines((await cli(['config', 'path'])).stdout);
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path.startsWith(home())).toBe(true);
  });

  test('auth stores from a pipe, never prints the key, and env consent is explicit', async () => {
    await cli(['auth', 'set', 'openai'], { stdin: 'sk-secret\n' });
    const listed = await cli(['auth', 'list']);
    expect(listed.stdout).toMatch(/openai\s+file/);
    expect(listed.stdout).not.toContain('sk-secret');
    const env = { TYPESAFE_AI_API_KEY: 'from-env' };
    expect((await cli(['auth', 'list'], { env })).stdout).toMatch(/typesafe\s+none/);
    await cli(['auth', 'env', 'on']);
    expect((await cli(['auth', 'list'], { env })).stdout).toMatch(/typesafe\s+env/);
    expect((await cli(['auth', 'env', 'maybe'])).code).toBe(2);
    expect((await cli(['auth', 'remove', 'openai'])).stdout).toContain('Removed');
    expect((await cli(['auth', 'set', 'nobody'], { stdin: 'k' })).code).toBe(2);
  });

  test('facets list, show, enable and disable', async () => {
    expect((await cli(['facets', 'list'])).stdout).toMatch(/\* core/);
    expect((await cli(['facets', 'show', 'visibility'])).stdout).toContain('public');
    expect((await cli(['facets', 'show', 'nope'])).code).toBe(2);
    await cli(['facets', 'enable', 'finance']);
    expect((await cli(['facets', 'list'])).stdout).toMatch(/\* finance/);
    await cli(['facets', 'disable', 'finance']);
    expect((await cli(['facets', 'list'])).stdout).toMatch(/ {2}finance/);
  });

  test('doctor exits 1 when a required check fails', async () => {
    const failing = await cli(['doctor']);
    expect(failing.code).toBe(1);
    expect(failing.stdout).toContain('FAIL');
    await cli(['auth', 'set', 'openai'], { stdin: 'k' });
    expect((await cli(['doctor', '--json'])).code).toBe(0);
  });

  test('cleanup and review print nothing to do on an empty index', async () => {
    expect((await cli(['cleanup'])).code).toBe(0);
    expect((await cli(['review'])).stdout).toBe('');
    expect((await cli(['review', '--accept', 'all'])).code).toBe(2);
    expect((await cli(['review', '--accept', '1', '--reject', '2'])).code).toBe(2);
  });
});

describe('setup', () => {
  test('--yes needs --folder, and a terminal is needed without it', async () => {
    expect((await cli(['setup', '--yes'])).code).toBe(2);
    const piped = await cli(['setup']);
    expect(piped.code).toBe(2);
    expect(piped.stderr).toContain('terminal');
  });

  test('--yes needs a key stored or piped', async () => {
    const { code, stderr } = await cli(['setup', '--yes', '--folder', root]);
    expect(code).toBe(2);
    expect(stderr).toContain('No key');
  });

  test('--yes takes a piped key, adds, enables, scans, and writes no tags', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'hello');
    const { code, stdout } = await cli(
      ['setup', '--yes', '--folder', root, '--packs', 'core,finance'],
      { stdin: 'sk-test' },
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Scanned 1 files in');
    expect(stdout).toContain('Next: jevonganize organize');
    expect(await readTags(path)).toEqual([]);
    expect((await cli(['auth', 'list'])).stdout).toMatch(/openai\s+file/);
    const list = (await cli(['facets', 'list'])).stdout;
    expect(list).toMatch(/\* finance/);
    expect(list).toMatch(/ {2}time/);
  });
});

test('ask with no key refuses with exit 2', async () => {
  const { code, stderr } = await cli(['ask', 'hello']);
  expect(code).toBe(2);
  expect(stderr).toContain('API key');
});

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

describe('organize against a stub provider', () => {
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
        response.end(
          JSON.stringify({ answers: answerAll(body, 0.99), usage: { input_tokens: 10 } }),
        );
      });
    });
    await new Promise<void>((done) => {
      stub.listen(0, '127.0.0.1', done);
    });
    const { port } = stub.address() as AddressInfo;
    await mkdir(join(home(), 'config'), { recursive: true });
    await writeFile(
      join(home(), 'config', 'config.toml'),
      `[provider]\nname = "openrouter"\nmodel = "jev"\nbase_url = "http://127.0.0.1:${port}"\n`,
    );
    await cli(['auth', 'set', 'openrouter'], { stdin: 'test-key' });
  });

  afterEach(async () => {
    await new Promise((done) => {
      stub.close(done);
    });
  });

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

describe('the server', () => {
  test('`jevonganize` prints the URL, serves, and stops on a signal', async () => {
    await cli(['config', 'set', 'watch.enabled', 'false']);
    const child = spawn(process.execPath, [CLI, '--no-open', '--port', '48733', '--json'], {
      env: { ...process.env, JEVONGANIZE_HOME: home() },
    });
    const url = await new Promise<string>((done) => {
      child.stdout.once('data', (chunk) => {
        done((JSON.parse(String(chunk)) as { url: string }).url);
      });
    });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:48733\/auth\?t=[0-9a-f]{64}$/);
    expect((await fetch(url, { redirect: 'manual' })).status).toBe(302);
    expect((await fetch('http://127.0.0.1:48733/')).status).toBe(401);
    const closed = new Promise((done) => {
      child.once('close', done);
    });
    child.kill('SIGTERM');
    // Windows has no signals: `kill` ends the process at once, so no handler runs and no code is set.
    expect(await closed).toBe(process.platform === 'win32' ? null : 0);
  });
});
