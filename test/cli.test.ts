import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { nodeSupported } from '../src/commands/floor.ts';
import { buildProgram } from '../src/commands/index.ts';
import { CLI, cli, home, lines, root, setupCliHome } from './cli-helpers.ts';

setupCliHome();

/** Every command `docs/cli.md` documents, as the words that reach it. */
const DOCUMENTED_COMMANDS = [
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

/** The command the words reach in the real program, if there is one. */
function findCommand(words: string[]): Command | undefined {
  let found: Command | undefined = buildProgram();
  for (const word of words) found = found?.commands.find((entry) => entry.name() === word);
  return found;
}

describe('the Node floor', () => {
  test.each([
    ['24.22.1', true],
    ['24.30.0', true],
    ['26.12.1', true],
    ['27.0.0', true],
    ['24.22.0', false],
    ['25.9.0', false],
    ['26.12.0', false],
    ['22.20.0', false],
  ])('%s is supported: %s', (version, supported) => {
    expect(nodeSupported(version)).toBe(supported);
  });
});

test('startup keeps its compile cache in a private folder of the app', async () => {
  expect((await cli(['--version'])).code).toBe(0);
  const { mode } = await stat(join(home(), 'cache', 'compile'));
  const permissions = mode & 0o777;
  // Windows has no POSIX modes to check.
  expect(permissions).toBe(process.platform === 'win32' ? permissions : 0o700);
});

describe('usage', () => {
  test('--version and --help print to stdout and exit 0', async () => {
    expect(await cli(['--version'])).toMatchObject({ code: 0, stdout: '0.1.0\n' });
    const help = await cli(['scan', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('--json');
  });

  test('an unknown flag is exit 2, and ends with a help hint on stderr', async () => {
    const flag = await cli(['scan', '--nope']);
    expect(flag).toMatchObject({ code: 2, stdout: '' });
    expect(lines(flag.stderr).at(-1)).toBe('Run: jevonganize scan --help');
    const nested = await cli(['tags', 'list', '--nope']);
    expect(lines(nested.stderr).at(-1)).toBe('Run: jevonganize tags list --help');
  });

  test('an unknown command, or a group with no command, is exit 2', async () => {
    expect((await cli(['nonsense'])).code).toBe(2);
    expect((await cli(['tags'])).code).toBe(2);
  });

  test('--dry-run with --apply is a usage error', async () => {
    const { code, stderr } = await cli(['organize', root, '--dry-run', '--apply']);
    expect(code).toBe(2);
    expect(stderr).toContain('cannot be combined');
  });
});

test('every documented command exists, with --json', () => {
  const missing = DOCUMENTED_COMMANDS.filter(
    (words) => !findCommand(words)?.options.some((option) => option.long === '--json'),
  );
  expect(missing).toEqual([]);
});

test('`jevonganize` prints the URL, serves, and stops on a signal', async () => {
  await cli(['config', 'set', 'watch.enabled', 'false']);
  const server = spawn(process.execPath, [CLI, '--no-open', '--port', '48733', '--json'], {
    env: { ...process.env, JEVONGANIZE_HOME: home() },
  });
  const url = await new Promise<string>((done) => {
    server.stdout.once('data', (chunk) => {
      done((JSON.parse(String(chunk)) as { url: string }).url);
    });
  });
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:48733\/auth\?t=[0-9a-f]{64}$/);
  expect((await fetch(url, { redirect: 'manual' })).status).toBe(302);
  expect((await fetch('http://127.0.0.1:48733/')).status).toBe(401);

  const closed = new Promise((done) => {
    server.once('close', done);
  });
  server.kill('SIGTERM');
  // Windows has no signals: `kill` ends the process at once, so no handler runs and no code is set.
  expect(await closed).toBe(process.platform === 'win32' ? null : 0);
});
