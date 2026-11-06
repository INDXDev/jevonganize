/** Shared setup of the scan tests: a library in a temp home, and ways to change it. */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { type Config, configSchema } from '../src/core/config.ts';
import { type Db, openDb } from '../src/core/db.ts';
import { scanLibrary } from '../src/core/scan.ts';
import { useTempHome } from './helpers.ts';

/** The index of the running test. */
export let db: Db;
/** The library of the running test. */
export let root: string;
/** The config of the running test. */
export let config: Config;
/** The temp home of the running test. */
export let home: () => string;

/** Replaces the config for the rest of this test. */
export const setConfig = (input: unknown) => {
  config = configSchema.parse(input);
};

/** Points the rest of this test at another library. */
export const setRoot = (path: string) => {
  root = path;
};

/** Gives each test in the file a temp home, an index and an empty library. */
export function setupScanLibrary(): void {
  home = useTempHome();
  beforeEach(async () => {
    root = join(home(), 'library');
    await mkdir(root);
    db = openDb();
    db.addLibrary(root);
    config = configSchema.parse({});
  });
  afterEach(() => {
    db.close();
  });
}

/** A path inside the library. */
export const at = (...parts: string[]) => join(root, ...parts);

/** Writes a file inside the library, with its folders. */
export async function put(name: string, content = 'x'): Promise<string> {
  const path = at(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

/** Scans the library. */
export const scan = () => scanLibrary(db, config, root);

/** What the index holds for the library, as relative paths. */
export const indexed = () =>
  db.filesUnder(root).map((file) => file.path.slice(root.length + 1).replaceAll(sep, '/'));

/** Waits long enough for a timestamp to move. */
export const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Saves the way many apps do: a temp file renamed over the original. */
export async function saveByRename(path: string, content = 'saved') {
  await writeFile(`${path}.new`, content);
  await rename(`${path}.new`, path);
}
