import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture, runFromSource, setupExtract, stubProgram, temp } from './extract-helpers.ts';

setupExtract();

// Each test runs the pipeline in its own Node process, the way the CLI runs it from source, to see
// what happens to the process as a whole: whether it exits, and what it leaves behind.

/**
 * A `soffice` that logs whether its profile turns macros off, and the profile path, then "converts"
 * by copying a fixture PDF into `--outdir`.
 */
const sofficeStub = (log: string) => `#!/bin/sh
profile=\${1#-env:UserInstallation=file://}
grep -c DisableMacrosExecution "$profile/user/registrymodifications.xcu" >> ${JSON.stringify(log)}
echo "$profile" >> ${JSON.stringify(log)}
shift
for arg; do case "$prev" in --outdir) out=$arg ;; esac; prev=$arg; done
cp ${JSON.stringify(fixture('report.pdf'))} "$out/converted.pdf"
`;

/** An `ffmpeg` that writes its pid and then hangs. */
const hungFfmpegStub = (pidFile: string) => `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`;

describe('worker start-up', () => {
  it('times out a task whose worker dies while starting, in a process with nothing else alive', async () => {
    const dieWhileStarting = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile, workerPool } from './src/extract/index.ts';
      const config = configSchema.parse({ budget: { timeout_seconds: 1 } });
      const running = extractFile(process.argv[1], config);
      while (!workerPool().threads.length) await new Promise(setImmediate);
      await Promise.all(workerPool().threads.map((thread) => thread.terminate()));
      process.stdout.write((await running).warnings.join());`;

    const { stdout } = await runFromSource(dieWhileStarting, [fixture('table.csv')]);

    expect(stdout).toBe('timed out');
  }, 30_000);

  it('lets a source-run CLI exit while a retained worker is idle', async () => {
    const extractOnce = `import {configSchema} from './src/core/config.ts';
      import {extractFile} from './src/extract/index.ts';
      process.stdout.write((await extractFile(process.argv[1],configSchema.parse({}))).text);`;

    const { stdout } = await runFromSource(extractOnce, [fixture('table.csv')], { timeout: 5000 });

    expect(stdout).toContain('lantern oil');
  });
});

describe('soffice profiles', () => {
  // Needs a shell script standing in for `soffice`. Windows looks for a compiled `soffice.exe`.
  it.skipIf(process.platform === 'win32')(
    'runs with macros off, in a profile that goes with the process',
    async () => {
      const bin = await mkdtemp(join(temp, 'bin-'));
      const log = join(bin, 'log');
      await stubProgram(bin, 'soffice', sofficeStub(log));
      const document = join(temp, 'old.doc');
      await writeFile(document, await readFile(fixture('plan.doc')));
      const convertOnce = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile } from './src/extract/index.ts';
      const config = configSchema.parse({ pipeline: [{ match: '*', use: ['libreoffice'] }] });
      const first = await extractFile(process.argv[1], config);
      console.log(first.text.length > 0);
      process.exit(0);`;
      const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };

      const run = await runFromSource(convertOnce, [document], { env });

      expect(run.stdout.trim()).toBe('true');
      const [macrosOffCount, profile = ''] = (await readFile(log, 'utf8')).trim().split('\n');
      expect(macrosOffCount).toBe('1');
      expect(basename(dirname(profile))).toMatch(/^jevonganize-soffice-/);
      expect(existsSync(dirname(profile))).toBe(false); // gone with the process
    },
  );
});

describe('hung tools', () => {
  // Needs a shell script standing in for `ffmpeg`. Windows looks for a compiled `ffmpeg.exe`.
  it.skipIf(process.platform === 'win32')(
    'runs from source with plain Node, kills a hung tool, and lets the process exit',
    async () => {
      const bin = join(temp, 'bin');
      const pidFile = join(temp, 'tool.pid');
      await mkdir(bin, { recursive: true });
      await stubProgram(bin, 'ffmpeg', hungFfmpegStub(pidFile));
      const extractVideo = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile } from './src/extract/index.ts';
      const config = configSchema.parse({ budget: { timeout_seconds: 3 } });
      const state = await extractFile(process.argv[1], config);
      process.stdout.write(JSON.stringify({ text: state.text, warnings: state.warnings }));`;
      const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
      const started = Date.now();

      const { stdout } = await runFromSource(extractVideo, [fixture('clip.mp4')], { env });

      expect(Date.now() - started).toBeLessThan(20_000);
      expect(JSON.parse(stdout).warnings.join()).toMatch(/ffmpeg-frames/);
      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');
    },
    30_000,
  );
});
