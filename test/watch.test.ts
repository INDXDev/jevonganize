import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import type { Config } from '../src/core/config.ts';
import { openDb } from '../src/core/db.ts';
import type { Db } from '../src/core/db.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { watchLibrary } from '../src/core/watch.ts';
import { useTempHome } from './helpers.ts';

const home = useTempHome();
let db: Db;
let root: string;
let config: Config;
let stop: () => Promise<void>;
const changes: number[][] = [];
const errors: unknown[] = [];

const start = () => {
  stop = watchLibrary(db, config, root, {
    onChange: (ids) => changes.push(ids),
    onError: (error) => errors.push(error),
  });
};
const settled = (check: () => void) => vi.waitFor(check, { timeout: 5000, interval: 25 });

beforeEach(async () => {
  root = join(home(), 'library');
  await mkdir(root);
  db = openDb();
  db.addLibrary(root);
  config = configSchema.parse({});
  changes.length = 0;
  errors.length = 0;
});

afterEach(async () => {
  await stop();
  db.close();
});

describe('watchLibrary', () => {
  it('reports no errors in normal running', async () => {
    start();
    await settled(() => expect(db.listLibraries()[0]?.scanned_at).toBeTruthy());
    expect(errors).toEqual([]);
  });

  it('walks at startup', async () => {
    await writeFile(join(root, 'a.txt'), 'x');
    start();
    await settled(() => expect(db.fileByPath(join(root, 'a.txt'))).toBeDefined());
    expect(changes).toHaveLength(1);
  });

  it('notices a new file and an xattr-only tag change', async () => {
    start();
    await settled(() => expect(db.listLibraries()[0]?.scanned_at).toBeTruthy());
    const path = join(root, 'a.txt');
    await writeFile(path, 'x');
    await settled(() => expect(db.fileByPath(path)).toBeDefined());
    await writeTags(path, ['outside']);
    await settled(() =>
      expect(db.fileTags(db.fileByPath(path)!.id)).toEqual([{ tag: 'outside', ai: false }]),
    );
    expect(await readTags(path)).toEqual(['outside']);
  });

  it('keeps a row through a rename, and drops it on a delete', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'x');
    await writeFile(join(root, 'keep.txt'), 'x'); // a root left with no files keeps its rows
    start();
    await settled(() => expect(db.fileByPath(path)).toBeDefined());
    const { id } = db.fileByPath(path)!;
    const moved = join(root, 'b.txt');
    await rename(path, moved);
    await settled(() => expect(db.fileById(id)?.path).toBe(moved));
    await rm(moved);
    await settled(() => expect(db.fileById(id)).toBeUndefined());
  });

  it('sees files inside a folder moved in', async () => {
    const outside = join(home(), 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'a.txt'), 'x');
    start();
    await settled(() => expect(db.listLibraries()[0]?.scanned_at).toBeTruthy());
    await rename(outside, join(root, 'moved'));
    await settled(() => expect(db.fileByPath(join(root, 'moved', 'a.txt'))).toBeDefined());
  });

  it('never indexes an excluded file it hears about', async () => {
    start();
    await settled(() => expect(db.listLibraries()[0]?.scanned_at).toBeTruthy());
    await writeFile(join(root, '.env'), 'x');
    await writeFile(join(root, 'marker.txt'), 'x');
    await settled(() => expect(db.fileByPath(join(root, 'marker.txt'))).toBeDefined());
    expect(db.fileByPath(join(root, '.env'))).toBeUndefined();
  });
});

describe('watchLibrary walks and stops', () => {
  it('walks again every walk_minutes, which catches what events miss', async () => {
    config = configSchema.parse({ watch: { walk_minutes: 0.002 } }); // 120 ms
    start();
    await settled(() => expect(db.listLibraries()[0]?.scanned_at).toBeTruthy());
    const first = db.listLibraries()[0]?.scanned_at;
    await settled(() => expect(db.listLibraries()[0]?.scanned_at).toBeGreaterThan(first!));
  });

  it('survives a failing walk by reporting it', async () => {
    const seen: unknown[] = [];
    stop = watchLibrary(db, config, join(home(), 'missing'), {
      onChange: () => {},
      onError: (error) => seen.push(error),
    });
    await settled(() => expect(seen.length).toBeGreaterThan(0));
  });

  it('does nothing after stop', async () => {
    start();
    await settled(() => expect(db.listLibraries()[0]?.scanned_at).toBeTruthy());
    await stop();
    await writeFile(join(root, 'late.txt'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(db.fileByPath(join(root, 'late.txt'))).toBeUndefined();
  });
});
