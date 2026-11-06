import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readScanTags } from '../src/core/tag-reader.ts';
import { readBatch } from '../src/core/tag-worker.ts';
import { writeTags } from '../src/core/tags.ts';
import { useTempHome } from './helpers.ts';
const home = useTempHome();

describe('scan tag reads', () => {
  it('dispatches a large batch to the worker and reads real attributes back', async () => {
    const files = Array.from({ length: 32 }, (_, i) => join(home(), `batch-${i}.txt`));
    for (const file of files) await writeFile(file, 'fixture');
    await writeTags(files[0]!, ['worker:yes']);
    const results = await readScanTags(files);
    expect(results[0]).toEqual({ path: files[0], tags: ['worker:yes'] });
    expect(results.slice(1)).toEqual(files.slice(1).map((path) => ({ path, tags: [] })));
  });
  it('reads real disk tags in input order and keeps bad paths separate from untagged files', async () => {
    const tagged = join(home(), 'tagged.txt'),
      plain = join(home(), 'plain.txt'),
      missing = join(home(), 'gone');
    await writeFile(tagged, 'tagged');
    await writeFile(plain, 'plain');
    await writeTags(tagged, ['topic:scan']);
    const result = await readScanTags([plain, tagged, missing]);
    expect(result.slice(0, 2)).toEqual([
      { path: plain, tags: [] },
      { path: tagged, tags: ['topic:scan'] },
    ]);
    expect(result[2]).toMatchObject({ path: missing, error: expect.stringContaining('ENOENT') });
    expect(await readScanTags([])).toEqual([]);
  });
  it('rechecks regular files in the worker and never follows a link', async () => {
    const target = join(home(), 'target'),
      link = join(home(), 'link');
    await writeFile(target, 'original');
    await writeTags(target, ['private']);
    await symlink(target, link);
    expect(await readBatch([link, home()])).toEqual([
      { path: link, error: 'not a regular file' },
      { path: home(), error: 'not a regular file' },
    ]);
    expect(await readBatch([target])).toEqual([{ path: target, tags: ['private'] }]);
  });
});
