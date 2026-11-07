import { readFile, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { extractFile, isFailed, workerPool } from '../src/extract/index.ts';
import { config, extract, fixture, setupExtract, temp } from './extract-helpers.ts';

setupExtract();

/** A subject of 2000 letters, each followed by a zero-width space that the cap strips. */
const OVERLONG_SUBJECT = 's​'.repeat(2000);

describe('the pipeline', () => {
  it('rejects an unknown extractor as a config error', async () => {
    const unknownExtractor = config({}, { pipeline: [{ match: '*', use: ['nope'] }] });

    await expect(extractFile(fixture('table.csv'), unknownExtractor)).rejects.toThrow(UserError);
  });

  it('gives a file that matches no row only name, size and mime', async () => {
    const imagesOnly = { pipeline: [{ match: 'image/*', use: ['image'] }] };

    const state = await extract('table.csv', {}, imagesOnly);

    expect(Object.keys(state.metadata).toSorted()).toEqual(['mime', 'name', 'size']);
    expect(state.text).toBe('');
  });

  it('caps metadata and leaves out the folder', async () => {
    const path = join(temp, 'long.eml');
    await writeFile(path, `Subject: ${OVERLONG_SUBJECT}\r\n\r\nbody`);

    const { metadata } = await extractFile(path, config());

    expect(metadata.subject).toBe('s'.repeat(500));
    expect(metadata.name).toBe('long.eml');
    expect(JSON.stringify(metadata)).not.toContain(temp);
  });

  it('opens regular files only', async () => {
    const link = join(temp, 'link.pdf');
    await symlink(fixture('report.pdf'), link);
    const notRegular = [link, temp, join(temp, 'missing.txt')];

    for (const path of notRegular) {
      const state = await extractFile(path, config());
      expect(state.warnings).toEqual(['not a regular file']);
      expect(isFailed(state)).toBe(true);
    }
  });
});

describe('reusing extraction work', () => {
  it('shares one extraction between callers, and gives each its own copy', async () => {
    const path = join(temp, 'shared.txt');
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
      expect((await extractFile(path, config())).metadata.name).toBe('shared.txt');
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      run.mockRestore();
    }
  });

  it('extracts again when the content or the budget changes', async () => {
    const path = join(temp, 'changing.txt');
    await writeFile(path, 'first version');
    // Both versions have the same size, so an older mtime is what tells them apart.
    const anHourAgo = new Date(Date.now() - 3_600_000);
    await utimes(path, anHourAgo, anHourAgo);
    const run = vi.spyOn(workerPool(), 'run');
    try {
      await extractFile(path, config());

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
    const tinyTimeout = config({ timeout_seconds: 0.001 });

    const states = await Promise.all([
      extractFile(path, tinyTimeout),
      extractFile(path, tinyTimeout),
    ]);

    expect(states.map((state) => state.warnings)).toEqual([['timed out'], ['timed out']]);
  });
});
