/** Optional external programs. No shell: a path is one argument, and a hung program is killed. */
import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type { SourceFile } from './source.ts';

const TOOL_GRACE_MS = 250; // a child must die before the pool terminates the worker that could kill it

/** The absolute path of a program on PATH. */
export function findTool(name: string): string | undefined {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, file);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not in this directory
    }
  }
  return undefined;
}

/** Which optional programs are on PATH, for `doctor`. */
export const optionalTools = () =>
  Object.fromEntries(['soffice', 'ffmpeg'].map((name) => [name, Boolean(findTool(name))]));

/** No shell. SIGKILL, because a hung tool may ignore anything politer. */
// shortcut: kills the tool, not any process it forked, use a process group if `soffice` ever leaves one
export const runTool = (tool: string, args: string[], file: SourceFile) =>
  promisify(execFile)(tool, args, {
    timeout: Math.max(1, file.deadline - Date.now() - TOOL_GRACE_MS),
    killSignal: 'SIGKILL',
  });

/** Gives a tool somewhere to write, and removes it whatever happens. */
export async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'jevonganize-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
