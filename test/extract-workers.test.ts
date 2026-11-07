import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { extractFile, isFailed, workerPool } from '../src/extract/index.ts';
import { config, extract, fixture, setupExtract, temp } from './extract-helpers.ts';

setupExtract();

/** A binary plist holding `true`, as macOS stores the screen-capture flag. */
const PLIST_TRUE =
  '62 70 6C 69 73 74 30 30 09 08 00 00 00 00 00 00 01 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 09';

/** Matches a value import or re-export, and captures its module: `import type` is left out. */
const VALUE_IMPORT = /^(?:import|export) (?!type )[^'"]*?from '([^']+)'/gm;

/** Every module a file reaches through value imports: `import type` costs a worker nothing. */
async function reachedModules(file: string, seen = new Set<string>()): Promise<Set<string>> {
  const source = await readFile(file, 'utf8');
  for (const [, name = ''] of source.matchAll(VALUE_IMPORT)) {
    const isRelative = name.startsWith('.');
    const target = isRelative ? join(dirname(file), name) : name;
    if (seen.has(target)) continue;
    seen.add(target);
    if (isRelative) await reachedModules(target, seen);
  }
  return seen;
}

/** Terminates every worker the pool holds now. */
const terminateWorkers = () =>
  Promise.all(workerPool().threads.map((thread) => thread.terminate()));

describe('worker failures', () => {
  it('terminates on timeout, failing that file', async () => {
    const state = await extract('report.pdf', { timeout_seconds: 0.001 });

    expect(state.warnings).toEqual(['timed out']);
    expect(state.metadata).toMatchObject({ name: 'report.pdf', mime: 'application/pdf' });
    expect(isFailed(state)).toBe(true);
  });

  it('a timeout fails no other file', async () => {
    await extract('report.pdf', { timeout_seconds: 0.001 });

    expect((await extract('report.pdf')).text).not.toBe('');
  });

  it('fails one file when its worker dies mid-task', async () => {
    // With no idle worker the task needs a new one, and piscina hands it over as that one is ready.
    await terminateWorkers();
    const workerCreated = once(workerPool(), 'workerCreate');
    const running = extract('photo.heic', { timeout_seconds: 5 });
    await workerCreated;
    await new Promise(setImmediate);
    await terminateWorkers();

    const state = await running;

    expect(state.warnings[0]).toMatch(/^worker failed/);
    expect(isFailed(state)).toBe(true);
    expect((await extract('table.csv')).text).toContain('lantern oil');
  });

  it('does not count time queued behind other files against a timeout', async () => {
    const extractions = Array.from({ length: 200 }, () =>
      extract('photo.jpg', { timeout_seconds: 5 }),
    );

    const states = await Promise.all(extractions);

    expect(states.every((state) => state.images.length === 1)).toBe(true);
  }, 60_000);
});

describe('what a worker loads', () => {
  it('stays clear of zod and native tag code, which each worker would pay to start', async () => {
    const loaded = await reachedModules(join(import.meta.dirname, '../src/extract/worker.ts'));

    expect(loaded.has('./worker.ts')).toBe(false);
    const costly = [...loaded].filter((name) => ['zod', 'koffi', 'piscina'].includes(name));
    expect(costly).toEqual([]);
  });

  it.runIf(process.platform === 'darwin')(
    'still reports a macOS screen capture, read before the task',
    async () => {
      const path = join(temp, 'capture.png');
      await writeFile(path, await readFile(fixture('tiny-transparent.png')));
      const flag = 'com.apple.metadata:kMDItemIsScreenCapture';
      await promisify(execFile)('xattr', ['-wx', flag, PLIST_TRUE, path]);

      const { metadata } = await extractFile(path, config());

      expect(metadata.screenshot).toBe(true);
    },
  );
});
