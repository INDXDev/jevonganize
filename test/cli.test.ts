import { spawn } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { nodeSupported } from '../src/commands/floor.ts';
import { buildProgram } from '../src/commands/index.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import type { Job } from '../src/types.ts';
import { CLI, cli, home, lines, ndjson, root, setupCliHome } from './cli-helpers.ts';

setupCliHome();

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

describe('startup', () => {
  test('keeps its compile cache in a private folder of the app', async () => {
    expect((await cli(['--version'])).code).toBe(0);
    const { mode } = await stat(join(home(), 'cache', 'compile'));
    expect(mode & 0o777).toBe(process.platform === 'win32' ? mode & 0o777 : 0o700);
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
});

describe('the documented commands', () => {
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
      ['refresh'],
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

describe('refresh', () => {
  test('--dry-run lists candidates and sends nothing, a hostile tag prints safely, and no key refuses', async () => {
    await writeFile(join(root, 'pwned-notes.txt'), 'hello');
    await cli(['scan', root]);
    const tag = 'pwned]0;x';
    const dry = await cli(['refresh', tag, '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.stdout).not.toContain('');
    expect(dry.stdout).toContain('pwned-notes.txt');
    expect(dry.stdout).toContain('Nothing was sent.');
    const json = await cli(['refresh', tag, '--dry-run', '--json']);
    expect(JSON.parse(json.stdout)).toMatchObject({
      tag,
      candidates: [{ name: 'pwned-notes.txt' }],
    });
    const refused = await cli(['refresh', tag]);
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
});

describe('tags: matching and failures', () => {
  test('--tag-match any widens a repeated --tag', async () => {
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'b.txt'), 'b');
    await writeTags(join(root, 'a.txt'), ['topic:law']);
    await writeTags(join(root, 'b.txt'), ['topic:tax']);
    await cli(['scan', root]);
    const flags = ['--tag', 'topic:law', '--tag', 'topic:tax'];
    expect((await cli(['search', ...flags])).stdout).not.toContain('a.txt');
    const any = (await cli(['search', ...flags, '--tag-match', 'any'])).stdout;
    expect(any).toContain('a.txt');
    expect(any).toContain('b.txt');
    expect((await cli(['search', ...flags, '--tag-match', 'some'])).code).toBe(2);
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
