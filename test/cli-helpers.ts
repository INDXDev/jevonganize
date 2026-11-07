/** Shared setup of the CLI tests: the real binary, in a temp home with an empty library. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, vi } from 'vitest';
import { useTempHome } from './helpers.ts';

/** The entry point the tests run. */
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The temp home of the running test. */
export let home: () => string;
/** An empty folder in that home. */
export let root: string;

/** Gives each test in the file a temp home and an empty folder. */
export function setupCliHome(): void {
  vi.setConfig({ testTimeout: 60_000 }); // each step spawns a real process
  home = useTempHome();
  beforeEach(async () => {
    root = join(home(), 'library');
    await mkdir(root);
    await mkdir(join(home(), 'config'), { recursive: true });
    await writeFile(join(home(), 'config', 'config.toml'), 'language = "en"\n');
  });
}

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the real CLI, async so a stub provider in this process can answer it. */
export function cli(
  args: string[],
  options: { stdin?: string; env?: Record<string, string> } = {},
) {
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

/** The lines of some output, without empty ones. */
export const lines = (text: string) => text.trim().split('\n').filter(Boolean);

/** The JSON values of NDJSON output. */
export const ndjson = <T>(text: string) => lines(text).map((line) => JSON.parse(line) as T);

/** Writes each file of `contents` into the library folder, and returns their paths by name. */
export async function writeFiles(
  contents: Record<string, string>,
): Promise<Record<string, string>> {
  const paths: Record<string, string> = {};
  for (const [name, text] of Object.entries(contents)) {
    const path = join(root, name);
    await writeFile(path, text);
    paths[name] = path;
  }
  return paths;
}

/** Writes the files into the library folder, then scans it with the real CLI. */
export async function scanFiles(contents: Record<string, string>): Promise<Record<string, string>> {
  const paths = await writeFiles(contents);
  await cli(['scan', root]);
  return paths;
}

/** The short plan id a text command printed after `word`, as in `Plan 1a2b3c4d` or `undo 1a2b3c4d`. */
export function printedPlanId(stdout: string, word = 'Plan'): string {
  return new RegExp(`${word} ([0-9a-f]{8})`).exec(stdout)?.[1] ?? '';
}
