import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { extractFile, isFailed, workerPool } from '../src/extract/index.ts';
import { config, extract, fixture, setupExtract, temp } from './extract-helpers.ts';

setupExtract();

describe('the pipeline', () => {
  it('rejects an unknown extractor as a config error', async () => {
    const bad = config({}, { pipeline: [{ match: '*', use: ['nope'] }] });
    await expect(extractFile(fixture('table.csv'), bad)).rejects.toThrow(UserError);
  });

  it('gives a file that matches no row only name, size and mime', async () => {
    const state = await extract(
      'table.csv',
      {},
      { pipeline: [{ match: 'image/*', use: ['image'] }] },
    );
    expect(Object.keys(state.metadata).toSorted()).toEqual(['mime', 'name', 'size']);
    expect(state.text).toBe('');
  });

  it('caps metadata and leaves out the folder', async () => {
    const path = join(temp, 'long.eml');
    await writeFile(path, `Subject: ${'s​'.repeat(2000)}\r\n\r\nbody`);
    const { metadata } = await extractFile(path, config());
    expect(metadata.subject).toBe('s'.repeat(500));
    expect(metadata.name).toBe('long.eml');
    expect(JSON.stringify(metadata)).not.toContain(temp);
  });

  it('opens regular files only', async () => {
    const link = join(temp, 'link.pdf');
    await symlink(fixture('report.pdf'), link);
    for (const path of [link, temp, join(temp, 'missing.txt')]) {
      const state = await extractFile(path, config());
      expect(state.warnings).toEqual(['not a regular file']);
      expect(isFailed(state)).toBe(true);
    }
  });
});

describe('worker failures', () => {
  it('terminates on timeout, failing that file and no other', async () => {
    const state = await extract('report.pdf', { timeout_seconds: 0.001 });
    expect(state.warnings).toEqual(['timed out']);
    expect(state.metadata).toMatchObject({ name: 'report.pdf', mime: 'application/pdf' });
    expect(isFailed(state)).toBe(true);
    expect((await extract('report.pdf')).text).not.toBe('');
  });

  it('fails one file when its worker dies mid-task', async () => {
    const pool = workerPool();
    // With no idle worker the task needs a new one, and piscina hands it over as that one is ready.
    await Promise.all(pool.threads.map((thread) => thread.terminate()));
    const ready = once(pool, 'workerCreate');
    const running = extract('photo.heic', { timeout_seconds: 5 });
    await ready;
    await new Promise(setImmediate);
    await Promise.all(pool.threads.map((thread) => thread.terminate()));
    const state = await running;
    expect(state.warnings[0]).toMatch(/^worker failed/);
    expect(isFailed(state)).toBe(true);
    expect((await extract('table.csv')).text).toContain('lantern oil');
  });

  it('times out a task whose worker dies while starting, in a process with nothing else alive', async () => {
    const script = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile, workerPool } from './src/extract/index.ts';
      const config = configSchema.parse({ budget: { timeout_seconds: 1 } });
      const running = extractFile(process.argv[1], config);
      while (!workerPool().threads.length) await new Promise(setImmediate);
      await Promise.all(workerPool().threads.map((thread) => thread.terminate()));
      process.stdout.write((await running).warnings.join());`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '--eval', script, fixture('table.csv')],
      { cwd: join(import.meta.dirname, '..') },
    );
    expect(stdout).toBe('timed out');
  }, 30_000);

  it('does not count time queued behind other files against a timeout', async () => {
    const paths = Array.from({ length: 200 }, () => extract('photo.jpg', { timeout_seconds: 5 }));
    const states = await Promise.all(paths);
    expect(states.every((state) => state.images.length === 1)).toBe(true);
  }, 60_000);
});

/** Every module a file reaches through value imports: `import type` costs a worker nothing. */
async function reached(file: string, seen = new Set<string>()): Promise<Set<string>> {
  const source = await readFile(file, 'utf8');
  const imports = source.matchAll(/^(?:import|export) (?!type )[^'"]*?from '([^']+)'/gm);
  for (const [, name = ''] of imports) {
    const target = name.startsWith('.') ? join(dirname(file), name) : name;
    if (seen.has(target)) continue;
    seen.add(target);
    if (name.startsWith('.')) await reached(target, seen);
  }
  return seen;
}

describe('what a worker loads', () => {
  it('stays clear of zod and native tag code, which each worker would pay to start', async () => {
    const loaded = await reached(join(import.meta.dirname, '../src/extract/worker.ts'));
    expect(loaded.has('./worker.ts')).toBe(false);
    expect([...loaded].filter((name) => ['zod', 'koffi', 'piscina'].includes(name))).toEqual([]);
  });

  it.runIf(process.platform === 'darwin')(
    'still reports a macOS screen capture, read before the task',
    async () => {
      const path = join(temp, 'capture.png');
      await writeFile(path, await readFile(fixture('tiny-transparent.png')));
      await promisify(execFile)('xattr', [
        '-wx',
        'com.apple.metadata:kMDItemIsScreenCapture',
        // A binary plist holding `true`.
        '62 70 6C 69 73 74 30 30 09 08 00 00 00 00 00 00 01 01 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 09',
        path,
      ]);
      expect((await extractFile(path, config())).metadata.screenshot).toBe(true);
    },
  );
});

describe('soffice profiles', () => {
  it('runs with macros off, in a profile that goes with the process', async () => {
    const bin = await mkdtemp(join(temp, 'bin-'));
    const log = join(bin, 'log');
    await writeFile(
      join(bin, 'soffice'),
      `#!/bin/sh
profile=\${1#-env:UserInstallation=file://}
grep -c DisableMacrosExecution "$profile/user/registrymodifications.xcu" >> ${JSON.stringify(log)}
echo "$profile" >> ${JSON.stringify(log)}
shift
for arg; do case "$prev" in --outdir) out=$arg ;; esac; prev=$arg; done
cp ${JSON.stringify(fixture('report.pdf'))} "$out/converted.pdf"
`,
    );
    await chmod(join(bin, 'soffice'), 0o755);
    const path = join(temp, 'old.doc');
    await writeFile(path, await readFile(fixture('plan.doc')));
    const code = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile, workerPool } from './src/extract/index.ts';
      const config = configSchema.parse({ pipeline: [{ match: '*', use: ['libreoffice'] }] });
      const first = await extractFile(process.argv[1], config);
      console.log(first.text.length > 0);
      process.exit(0);`;
    const run = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '-e', code, path],
      {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
      },
    );
    expect(run.stdout.trim()).toBe('true');
    const [count, profile = ''] = (await readFile(log, 'utf8')).trim().split('\n');
    expect(count).toBe('1');
    expect(basename(dirname(profile))).toMatch(/^jevonganize-soffice-/);
    expect(existsSync(dirname(profile))).toBe(false); // gone with the process
  });
});

describe('hung tools', () => {
  // Needs a shell script standing in for `ffmpeg`. Windows looks for a compiled `ffmpeg.exe`.
  it.skipIf(process.platform === 'win32')(
    'runs from source with plain Node, kills a hung tool, and lets the process exit',
    async () => {
      const bin = join(temp, 'bin');
      const pidFile = join(temp, 'tool.pid');
      await promisify(execFile)('mkdir', ['-p', bin]);
      await writeFile(join(bin, 'ffmpeg'), `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`);
      await chmod(join(bin, 'ffmpeg'), 0o755);
      const script = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile } from './src/extract/index.ts';
      const config = configSchema.parse({ budget: { timeout_seconds: 3 } });
      const state = await extractFile(process.argv[1], config);
      process.stdout.write(JSON.stringify({ text: state.text, warnings: state.warnings }));`;
      const started = Date.now();
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '--eval', script, fixture('clip.mp4')],
        {
          cwd: join(import.meta.dirname, '..'),
          env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
        },
      );
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(JSON.parse(stdout).warnings.join()).toMatch(/ffmpeg-frames/);
      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');
    },
    30_000,
  );
});

describe('reusing extraction work', () => {
  it('shares an unchanged extraction, copies results, and invalidates content and budget changes', async () => {
    const path = join(temp, 'cached.txt');
    await writeFile(path, 'first version');
    const run = vi.spyOn(workerPool(), 'run');
    try {
      const [one, two] = await Promise.all([
        extractFile(path, config()),
        extractFile(path, config()),
      ]);
      expect(run).toHaveBeenCalledTimes(1);
      one.text = 'mutated';
      one.metadata.name = 'other';
      expect(two.text).toBe('first version');
      expect((await extractFile(path, config())).metadata.name).toBe('cached.txt');
      expect(run).toHaveBeenCalledTimes(1);
      await writeFile(path, 'other version');
      expect((await extractFile(path, config())).text).toBe('other version');
      await extractFile(path, config({ text_chars: 5 }));
      expect(run).toHaveBeenCalledTimes(3);
    } finally {
      run.mockRestore();
    }
  });
  it('returns typed failures to every caller sharing a timeout', async () => {
    const path = join(temp, 'shared-timeout.pdf');
    await writeFile(path, await readFile(fixture('report.pdf')));
    const states = await Promise.all([
      extractFile(path, config({ timeout_seconds: 0.001 })),
      extractFile(path, config({ timeout_seconds: 0.001 })),
    ]);
    expect(states.map((state) => state.warnings)).toEqual([['timed out'], ['timed out']]);
  });
  it('lets a source-run CLI exit while a retained worker is idle', async () => {
    const script = `import {configSchema} from './src/core/config.ts';
      import {extractFile} from './src/extract/index.ts';
      process.stdout.write((await extractFile(process.argv[1],configSchema.parse({}))).text);`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '--eval', script, fixture('table.csv')],
      { cwd: join(import.meta.dirname, '..'), timeout: 5000 },
    );
    expect(stdout).toContain('lantern oil');
  });
});
