import { lstat } from 'node:fs/promises';
import type { TagRead } from './tag-reader.ts';
import { readTags } from './tags.ts';

/** Rechecks each regular file at read time and keeps failures separate from empty tag sets. */
export async function readBatch(paths: string[]): Promise<TagRead[]> {
  return Promise.all(
    paths.map(async (path): Promise<TagRead> => {
      try {
        if (!(await lstat(path)).isFile()) throw new Error('not a regular file');
        return { path, tags: await readTags(path) };
      } catch (error) {
        return { path, error: (error as Error).message };
      }
    }),
  );
}
