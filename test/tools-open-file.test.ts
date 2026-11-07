import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, copyFile, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { callTool, tools } from '../src/core/tools.ts';
import { fixture } from './extract-helpers.ts';
import { as, at, ctx, idOf, scanAll, setupToolContext } from './tools-helpers.ts';

// A test must never start a real app. Each spawned process exits with `exitCode`.
let exitCode = 0;
vi.mock('node:child_process', async (actual) => ({
  ...(await actual<object>()),
  spawn: vi.fn<() => EventEmitter>(() => {
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', exitCode));
    return child;
  }),
}));

setupToolContext();

const isWindows = process.platform === 'win32';

/** Documents the OS may hand to their default app. */
const OPENABLE = ['plan.docx', 'budget.xlsx', 'deck.pptx', 'scan.PDF', 'photo.jpg', 'a.exe.pdf'];

/** Names that could run a program, so they are never opened. */
const RUNNABLE = [
  'a.app',
  'a.command',
  'a.EXE',
  'a.lnk',
  'a.sh',
  'a.jar',
  'a.webloc',
  'noext',
  'a.exe.',
];

/** Scans a new file into the library, clears the spawn record, and returns the file's id. */
async function addFile(name: string): Promise<number> {
  await writeFile(at(name), 'x');
  await scanAll();
  vi.mocked(spawn).mockClear();
  return idOf(name);
}

/** Opens a file with `process.platform` pretending to be `platform`. */
async function openOnPlatform(id: number, platform: string): Promise<void> {
  const realPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  await callTool('open_file', { id }, ctx).finally(() =>
    Object.defineProperty(process, 'platform', { value: realPlatform }),
  );
}

const firstSpawnArgs = () => vi.mocked(spawn).mock.calls[0]?.[1];

describe('open_file hands a document to the OS', () => {
  test.each(OPENABLE)('hands %s to the OS, as one argument and no shell', async (name) => {
    await callTool('open_file', { id: await addFile(name) }, ctx);
    // `explorer` takes the path quoted, still as one argument.
    const expectedArg = isWindows ? `"${at(name)}"` : at(name);
    expect(firstSpawnArgs()).toEqual([expectedArg]);
  });

  test.each([
    ['darwin', 'open', (path: string) => [path]],
    ['linux', 'xdg-open', (path: string) => [path]],
    ['win32', 'explorer', (path: string) => [`"${path}"`]],
  ])('on %s it calls %s', async (platform, command, expectedArgs) => {
    const id = await addFile('a, b.docx');
    await openOnPlatform(id, platform);
    const commandAndArgs = vi.mocked(spawn).mock.calls[0]?.slice(0, 2);
    expect(commandAndArgs).toEqual([command, expectedArgs(at('a, b.docx'))]);
  });

  test.runIf(!isWindows)(
    'opens a real document on a drive that marks every file executable',
    async () => {
      await copyFile(fixture('budget.xlsx'), at('budget.xlsx'));
      await chmod(at('budget.xlsx'), 0o777);
      await scanAll();
      await callTool('open_file', { id: idOf('budget.xlsx') }, ctx);
      expect(spawn).toHaveBeenCalled();
    },
  );

  test.runIf(!isWindows)('says when no app can open it', async () => {
    const id = await addFile('plan.docx');
    exitCode = 1;
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('No app');
    exitCode = 0;
  });
});

describe('open_file refuses what could run or is not in a library', () => {
  test.each(RUNNABLE)('refuses %s', async (name) => {
    const id = await addFile(name);
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('could run a program');
    expect(spawn).not.toHaveBeenCalled();
  });

  test.runIf(!isWindows)('refuses a file with an execute bit', async () => {
    const id = await addFile('run.txt');
    await chmod(at('run.txt'), 0o755);
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('could run a program');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('refuses a file that has gone, and a link planted after the scan', async () => {
    const id = await addFile('plan.docx');
    await rm(at('plan.docx'));
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('not in a library');
    await symlink('/bin/sh', at('plan.docx'));
    await expect(callTool('open_file', { id }, ctx)).rejects.toThrow('not in a library');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('takes an id, never a path', async () => {
    await expect(callTool('open_file', { path: '/x' } as never, ctx)).rejects.toThrow(UserError);
    await expect(callTool('open_file', { id: 999 }, ctx)).rejects.toThrow('not in a library');
  });

  test('stays out of reach of models', async () => {
    expect(tools.open_file.agent).toBe(false);
    await expect(callTool('open_file', { id: 1 }, as('mcp', true))).rejects.toThrow(UserError);
  });
});
