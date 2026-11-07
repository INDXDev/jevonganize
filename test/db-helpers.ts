/** Shared setup of the index tests: a fresh in-memory `db`, and small builders over it. */
import { sep } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { type Db, openDb } from '../src/core/db.ts';
import type { Plan } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

/** The index of the running test. */
export let db: Db;
/** The temp home of the running test. */
export let home: () => string;

/** Gives each test in the file a temp home and an in-memory index. */
export function setupMemoryDb(): void {
  home = useTempHome();
  beforeEach(() => {
    db = openDb(':memory:');
  });
  afterEach(() => {
    db.close();
  });
}

/** Most tests here take a path as an opaque key. Folders and base names need the OS's own form. */
export const native = (path: string) => path.replaceAll('/', sep);

export const addFile = (path: string, size = 1, mtimeMs = 1000) =>
  db.upsertFile(
    {
      path,
      dev: '1',
      ino: path,
      size,
      mtime_ns: String(BigInt(mtimeMs) * 1_000_000n),
      ctime_ns: '1',
    },
    { edited: false },
  );

export const tagged = (path: string, tags: string[]) => {
  const id = addFile(path);
  db.addFileTags(id, tags, false);
  return id;
};

export const found = (query: Parameters<Db['searchFiles']>[0]) =>
  db
    .searchFiles({ ...query, folder: query.folder && native(query.folder) })
    .files.map((file) => file.path.replaceAll(sep, '/'));

export const item = (file_id: number, tag: string, confidence: number | null = 0.6) =>
  ({ file_id, kind: 'suggest', tag, confidence, reason: 'r' }) as const;

export const plan = (
  id: string,
  created_at: number,
  status: Plan['status'] = 'proposed',
): Plan => ({
  id,
  title: 'title',
  source: 'user',
  status,
  created_at,
  ops: [{ file_id: 1, add: ['a'], remove: [] }],
  summary: { files: 1, added: { a: 1 }, removed: {} },
});
