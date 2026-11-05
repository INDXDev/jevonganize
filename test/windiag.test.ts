// TEMPORARY: prints what real Windows does, so docs/tags.md can say it. Removed once recorded.
import { watch } from 'node:fs';
import { copyFile, cp, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { release, version } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeTags } from '../src/core/tags.ts';
import { useTempHome } from './helpers.ts';

const home = useTempHome();
const S = ':jevonganize.tags';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const log = (...args: unknown[]) => process.stderr.write(`WINDIAG ${args.map(String).join(' ')}\n`);
const t = async (p: string) => {
  const s = await stat(p, { bigint: true });
  return [s.mtimeNs, s.ctimeNs, s.atimeNs];
};
const has = (p: string) =>
  readFile(p + S, 'utf8').then(
    (x) => x,
    (e: NodeJS.ErrnoException) => `<${e.code}>`,
  );

describe.runIf(process.platform === 'win32')('diag', () => {
  it('reports', async () => {
    log('os', release(), version(), 'tmp', home());
    const f = join(home(), 'a.txt');
    await writeFile(f, 'content');
    await wait(50);
    const a = await t(f);
    await writeFile(f + S, 'x');
    const b = await t(f);
    await wait(300);
    const c = await t(f);
    log(
      'raw write mtime moved',
      a[0] !== b[0],
      'ctime moved',
      a[1] !== b[1],
      'later moved',
      b[0] !== c[0],
      b[1] !== c[1],
    );
    await wait(50);
    await unlink(f + S);
    const d = await t(f);
    log('raw unlink mtime moved', c[0] !== d[0], 'ctime moved', c[1] !== d[1]);

    for (const [name, step] of [
      ['raw stream write', async (p: string) => writeFile(p + S, 'y')],
      ['raw stream delete', async (p: string) => unlink(p + S)],
      ['writeTags', async (p: string) => writeTags(p, ['a'])],
      ['writeTags clear', async (p: string) => writeTags(p, [])],
    ] as const) {
      const events: string[] = [];
      const w = watch(home(), { recursive: true }, (e, n) => events.push(`${e}:${n}`));
      await wait(200);
      await step(f);
      await wait(600);
      w.close();
      log('watch', name, JSON.stringify(events));
    }

    await writeTags(f, ['a']);
    const copy = join(home(), 'copy.txt');
    await copyFile(f, copy);
    log('fs.copyFile keeps', await has(copy));
    const copy2 = join(home(), 'copy2.txt');
    await cp(f, copy2);
    log('fs.cp keeps', await has(copy2));
    const copy3 = join(home(), 'copy3.txt');
    await writeFile(copy3, await readFile(f));
    log('read+write copy', await has(copy3));
    await writeFile(f, 'saved over');
    log('fs.writeFile over (CREATE_ALWAYS) keeps', await has(f));
    await writeTags(f, ['a']);
    const h = await open(f, 'r+');
    await h.write('X', 0);
    await h.close();
    log('in-place r+ keeps', await has(f));
    await writeFile(`${f}.new`, 'n');
    await rename(`${f}.new`, f);
    log('temp+rename keeps', await has(f));
    expect(true).toBe(true);
  });
});
