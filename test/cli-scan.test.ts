import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Job } from '../src/types.ts';
import { cli, ndjson, root, scanFiles, setupCliHome, writeFiles } from './cli-helpers.ts';

setupCliHome();

/** A tag holding the start of an escape sequence, which text output must not pass through. */
const HOSTILE_TAG = 'pwned\x1b]0;x\x07';

describe('scan', () => {
  test('adds a library and reports on stdout, skipping excluded files', async () => {
    await writeFiles({ 'a.txt': 'hello', '.env': 'SECRET=1' });
    const { code, stdout } = await cli(['scan', root]);
    expect(code).toBe(0);
    expect(stdout).toContain('1 files, 1 new, 0 changed.');
    expect(stdout).toContain('Skipped 1 by exclusion rules.');
  });

  test('--json is NDJSON ending in the final job', async () => {
    await scanFiles({ 'a.txt': 'hello' });
    const jobs = ndjson<Job>((await cli(['scan', root, '--json'])).stdout);
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
});

describe('show', () => {
  test('a file not in the index suggests scan', async () => {
    const miss = await cli(['show', join(root, 'none.txt')]);
    expect(miss.code).toBe(2);
    expect(miss.stderr).toContain('jevonganize scan');
  });

  test('a plain id works, for show and similar', async () => {
    await scanFiles({ 'a.txt': 'hello' });
    expect((await cli(['show', '1'])).stdout).toContain('(id 1)');
    expect((await cli(['similar', '1'])).code).toBe(0);
  });
});

describe('organize with no provider', () => {
  test('a folder outside every library is refused', async () => {
    const stray = await cli(['organize', root]);
    expect(stray).toMatchObject({ code: 2 });
    expect(stray.stderr).toContain('not in a library');
  });

  test('--dry-run needs no key and estimates the work', async () => {
    await scanFiles({ 'a.txt': 'hello' });
    const dry = await cli(['organize', root, '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('Nothing was sent.');
    const estimate = await cli(['organize', root, '--dry-run', '--json']);
    expect(JSON.parse(estimate.stdout)).toMatchObject({ files: 1, provider: 'openai' });
  });

  test('with no key it refuses before sending anything', async () => {
    await scanFiles({ 'a.txt': 'hello' });
    const refused = await cli(['organize', root]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('nothing was sent');
  });
});

describe('refresh', () => {
  test('--dry-run lists candidates, sends nothing, and prints a hostile tag safely', async () => {
    await scanFiles({ 'pwned-notes.txt': 'hello' });
    const dry = await cli(['refresh', HOSTILE_TAG, '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.stdout).not.toContain('\x1b');
    expect(dry.stdout).toContain('pwned-notes.txt');
    expect(dry.stdout).toContain('Nothing was sent.');
  });

  test('--dry-run --json keeps the tag as given', async () => {
    await scanFiles({ 'pwned-notes.txt': 'hello' });
    const json = await cli(['refresh', HOSTILE_TAG, '--dry-run', '--json']);
    expect(JSON.parse(json.stdout)).toMatchObject({
      tag: HOSTILE_TAG,
      candidates: [{ name: 'pwned-notes.txt' }],
    });
  });

  test('with no key it refuses before sending anything', async () => {
    await scanFiles({ 'pwned-notes.txt': 'hello' });
    const refused = await cli(['refresh', HOSTILE_TAG]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('nothing was sent');
  });
});
