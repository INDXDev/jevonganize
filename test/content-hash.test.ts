import { createHash } from 'node:crypto';
import { readFile, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentHash } from '../src/core/content-hash.ts';
import { useTempHome } from './helpers.ts';
const home = useTempHome();
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

describe('contentHash', () => {
  it('preserves SHA-256 and invalidates a same-size edit, even with mtime restored', async () => {
    const file = join(home(), 'file.txt');
    await writeFile(file, 'first');
    await utimes(file, 1000, 1000);
    expect(await contentHash(file)).toBe(`f1:${sha('first')}`);
    expect(await contentHash(file)).toBe(`f1:${sha('first')}`);
    await writeFile(file, 'other');
    await utimes(file, 1000, 1000);
    expect(await contentHash(file)).toBe(`f1:${sha('other')}`);
    expect(await readFile(file, 'utf8')).toBe('other');
  });
  it.skipIf(process.platform === 'win32')(
    'does not reuse a cached path after it becomes a symlink',
    async () => {
      const file = join(home(), 'target.txt'),
        link = join(home(), 'link.txt');
      await writeFile(file, 'hello');
      await contentHash(file);
      await symlink(file, link);
      await expect(contentHash(link)).rejects.toThrow(/ELOOP/);
    },
  );
});
