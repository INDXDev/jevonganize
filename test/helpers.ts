/** Shared test setup: a throwaway `JEVONGANIZE_HOME`, so no test touches real config or data. */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/**
 * Makes a fresh temp home and points `JEVONGANIZE_HOME` at it. Pair it with `removeTempHome`, or
 * use `useTempHome`. The path is resolved as the index stores it: macOS temp paths go through a symlink, and
 * Windows ones can hold an 8.3 short name, which only `native` expands.
 */
export function makeTempHome(): string {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'jevonganize-test-')));
  process.env.JEVONGANIZE_HOME = home;
  return home;
}

/** Deletes a temp home and unsets `JEVONGANIZE_HOME`. */
export function removeTempHome(home: string): void {
  delete process.env.JEVONGANIZE_HOME;
  rmSync(home, { recursive: true, force: true });
}

/** Gives each test in the file its own temp home. Call it at the top of a `describe` or file. */
export function useTempHome(): () => string {
  let home = '';
  beforeEach(() => {
    home = makeTempHome();
  });
  afterEach(() => removeTempHome(home));
  return () => home;
}
