import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configSchema, paths, UserError } from '../src/core/config.ts';
import type { Config } from '../src/core/config.ts';
import { openDb } from '../src/core/db.ts';
import type { Db } from '../src/core/db.ts';
import { recordWrite, scanLibrary, scanPaths } from '../src/core/scan.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { useTempHome } from './helpers.ts';

const home = useTempHome();
let db: Db;
let root: string;
let config: Config;

const at = (...parts: string[]) => join(root, ...parts);
async function put(name: string, content = 'x'): Promise<string> {
  const path = at(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}
const scan = () => scanLibrary(db, config, root);
const indexed = () =>
  db.filesUnder(root).map((file) => file.path.slice(root.length + 1).replaceAll(sep, '/'));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Saves the way many apps do: a temp file renamed over the original. */
async function saveByRename(path: string, content = 'saved') {
  await writeFile(`${path}.new`, content);
  await rename(`${path}.new`, path);
}

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

describe('walking', () => {
  it('indexes regular files as new, with a MIME type from the name, and stamps the library', async () => {
    await put('a.pdf');
    await put('deep/er/b.txt');
    const result = await scan();
    expect(result).toMatchObject({ files: 2, added: 2, changed: 0, removed: 0 });
    expect(indexed()).toEqual(['a.pdf', 'deep/er/b.txt']);
    expect(db.fileByPath(at('a.pdf'))).toMatchObject({ status: 'new', mime: 'application/pdf' });
    expect(db.listLibraries()[0]?.scanned_at).toBeGreaterThan(0);
  });

  it('never follows a symlink, and never opens a FIFO', async () => {
    const outside = join(home(), 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'x');
    await symlink(outside, at('dir-link'));
    await symlink(join(outside, 'secret.txt'), at('file-link'));
    // Windows has no FIFOs. Git's `mkfifo` there makes a regular `pipe.lnk`, which is indexed rightly.
    if (process.platform !== 'win32') execFileSync('mkfifo', [at('pipe')]);
    await put('real.txt');
    await scan();
    expect(indexed()).toEqual(['real.txt']);
  });

  it('skips secrets, and no setting can bring them back', async () => {
    for (const name of [
      '.env',
      '.env.local',
      'server.pem',
      'a.p12',
      'b.pfx',
      '.ssh/config',
      'id_rsa',
      'id_ed25519.pub',
      '.gnupg/key',
      '.aws/credentials',
      'login.keychain-db',
      'Library/Keychains/x',
      'vault.kdbx',
      'wallet.dat',
      'Library/Application Support/Google/Chrome/Default/Cookies',
      '.mozilla/firefox/p/logins.json',
      '.config/google-chrome/Default/Login Data',
      'AppData/Local/Google/Chrome/User Data/x',
    ]) {
      await put(name);
    }
    await put('deck.key'); // Keynote, deliberately allowed
    await put('credentials-for-visa.pdf');
    config = configSchema.parse({ exclude: ['!.env', '!*.pem', '!.ssh/', '!.ssh/config'] });
    const result = await scan();
    expect(indexed()).toEqual(['credentials-for-visa.pdf', 'deck.key']);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it('keeps secrets out when the library sits inside a secret folder', async () => {
    root = join(home(), '.ssh');
    await mkdir(root);
    await put('notes.txt');
    await scan();
    expect(indexed()).toEqual([]);
  });

  it('applies user exclusions relative to the library, and drops rows newly excluded', async () => {
    await put('node_modules/x.js');
    await put('keep.txt');
    await put('a.tmp');
    await put('Archive/old.txt');
    const result = await scan();
    expect(result.skipped).toBe(2);
    expect(indexed()).toEqual(['Archive/old.txt', 'keep.txt']);
    config = configSchema.parse({ exclude: ['/Archive'] });
    await scan();
    expect(indexed()).toEqual(['a.tmp', 'keep.txt', 'node_modules/x.js']);
  });

  it('never indexes its own config, data or cache, even from a home-sized library', async () => {
    root = home();
    await writeFile(join(dirname(paths.database()), 'stray'), 'x');
    await mkdir(paths.configDir(), { recursive: true });
    await writeFile(paths.credentialsFile(), 'openai = "k"');
    await mkdir(paths.thumbnails(), { recursive: true });
    await writeFile(join(paths.thumbnails(), 't.webp'), 'x');
    await put('library/a.txt');
    await scan();
    expect(indexed()).toEqual(['library/a.txt']);
  });

  it('refuses a missing root, and keeps the rows of an unplugged library', async () => {
    await put('a.txt');
    await scan();
    await rm(root, { recursive: true });
    await expect(scan()).rejects.toThrow(UserError);
    expect(db.filesUnder(root)).toHaveLength(1);
  });

  it('keeps the rows of a root that is now empty, and warns, as for an empty mount point', async () => {
    const path = await put('a.txt');
    await scan();
    await rm(path);
    const result = await scan();
    expect(result).toMatchObject({ files: 0, removed: 0 });
    expect(result.warnings.join()).toContain('1 are indexed');
    expect(indexed()).toEqual(['a.txt']);
  });

  // POSIX modes do not exist on Windows, so `chmod` cannot make a folder unreadable.
  it.skipIf(process.platform === 'win32')(
    'keeps rows under a folder it cannot read, and warns',
    async () => {
      const path = await put('locked/a.txt');
      await scan();
      execFileSync('chmod', ['000', dirname(path)]);
      try {
        const result = await scan();
        expect(result.removed).toBe(0);
        expect(result.warnings.join()).toContain('locked');
        expect(indexed()).toEqual(['locked/a.txt']);
      } finally {
        execFileSync('chmod', ['755', dirname(path)]);
      }
    },
  );

  it('yields to the event loop between batches, and reports progress', async () => {
    await Promise.all(Array.from({ length: 600 }, (_, index) => put(`f${index}`)));
    let turns = 0;
    const counter = setInterval(() => turns++, 0);
    const progress: number[] = [];
    await scanLibrary(db, config, root, ({ done }) => progress.push(done));
    clearInterval(counter);
    expect(progress).toEqual([256, 512, 600]);
    expect(turns).toBeGreaterThan(0);
  });
});

describe('fingerprints', () => {
  it('skips a file that did not change', async () => {
    await put('a.txt');
    await scan();
    const result = await scan();
    expect(result).toMatchObject({ files: 1, added: 0, changed: 0, ids: [] });
  });

  it('an outside tag change updates the mirror and keeps the status', async () => {
    const path = await put('a.txt');
    await scan();
    const id = db.fileByPath(path)!.id;
    db.setFileResult(id, { status: 'organized', hash: 'h' });
    await tick();
    await writeTags(path, ['outside']);
    const result = await scan();
    expect(result).toMatchObject({ changed: 1, ids: [id] });
    expect(db.fileTags(id)).toEqual([{ tag: 'outside', ai: false }]);
    expect(db.fileById(id)).toMatchObject({ status: 'organized', hash: 'h' });
  });

  it('a content change resets the status', async () => {
    const path = await put('a.txt');
    await scan();
    const id = db.fileByPath(path)!.id;
    db.setFileResult(id, { status: 'organized', hash: 'h' });
    await tick();
    await writeFile(path, 'longer');
    await scan();
    expect(db.fileById(id)).toMatchObject({ status: 'new', hash: null, size: 6 });
  });

  it('a rename keeps the row, its tags and their ai flag', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['t']);
    await scan();
    const id = db.fileByPath(path)!.id;
    db.addFileTags(id, ['t'], true);
    db.setFileResult(id, { status: 'organized' });
    await rename(path, at('b.txt'));
    const result = await scan();
    expect(result).toMatchObject({ moved: 1, added: 0, removed: 0 });
    expect(db.fileById(id)).toMatchObject({ path: at('b.txt'), status: 'organized' });
    expect(db.fileTags(id)).toEqual([{ tag: 't', ai: true }]);
  });

  it('a hard link is a second file, not a move', async () => {
    const path = await put('a.txt');
    await scan();
    execFileSync('ln', [path, at('b.txt')]);
    await scan();
    expect(indexed()).toEqual(['a.txt', 'b.txt']);
  });

  it('a deleted file loses its row, and answers stay', async () => {
    const path = await put('a.txt');
    await put('keep.txt'); // a root left with no files at all keeps its rows
    await writeTags(path, ['t']);
    await scan();
    db.putAnswer('k', 'f', []);
    db.linkAnswer(db.fileByPath(path)!.id, 'f', 'k');
    await rm(path);
    const result = await scan();
    expect(result.removed).toBe(1);
    expect(db.tagCounts()).toEqual([]);
    expect(db.getAnswer('k')).toEqual([]);
  });

  it('reports a removed row as changed, so a watcher refreshes after a delete', async () => {
    const path = await put('a.txt');
    await put('b.txt');
    await scan();
    const id = db.fileByPath(path)!.id;
    await rm(path);
    expect((await scan()).ids).toContain(id);
  });

  // POSIX modes do not exist on Windows, so `chmod` cannot make a file unreachable.
  it.skipIf(process.platform === 'win32')('keeps the row of a file it could not stat', async () => {
    await put('b.txt');
    await put('locked/a.txt');
    await scan();
    await chmod(at('locked'), 0o444); // the name can be listed, but lstat gets EACCES
    try {
      const result = await scan();
      expect(result.removed).toBe(0);
      expect(result.warnings.join()).toContain('EACCES');
      expect(indexed()).toContain('locked/a.txt');
    } finally {
      await chmod(at('locked'), 0o755);
    }
  });

  it('reads nothing from a stored root whose real path is a secret', async () => {
    const secret = join(home(), '.aws');
    await mkdir(secret);
    await writeFile(join(secret, 'credentials'), 'key');
    await symlink(secret, at('link'));
    expect(await scanLibrary(db, config, at('link'))).toMatchObject({ files: 0, skipped: 1 });
    expect(db.fileByPath(at('link', 'credentials'))).toBeUndefined();
  });
});

describe('mirror drift', () => {
  it('the disk wins in both directions', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['stays', 'goes']);
    await scan();
    const id = db.fileByPath(path)!.id;
    await tick();
    await writeTags(path, ['arrives', 'stays']);
    await scan();
    expect(db.fileTags(id).map((row) => row.tag)).toEqual(['arrives', 'stays']);
  });

  it('never writes to a file', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['t']);
    const before = await stat(path, { bigint: true });
    await scan();
    await tick();
    await writeTags(path, ['t', 'u']);
    const moved = await stat(path, { bigint: true });
    await scan();
    expect((await stat(path, { bigint: true })).ctimeNs).toBe(moved.ctimeNs);
    expect(moved.mtimeNs).toBe(before.mtimeNs);
    expect(await readTags(path)).toEqual(['t', 'u']);
  });
});

describe('lost tags', () => {
  it('a new inode with fewer tags raises one restore item per missing tag', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['one', 'two']);
    await scan();
    const id = db.fileByPath(path)!.id;
    db.addFileTags(id, ['two'], true);
    await saveByRename(path);
    const result = await scan();
    expect(result.restores).toBe(2);
    expect(db.reviewsForFile(id).map((row) => [row.kind, row.tag])).toEqual([
      ['restore', 'one'],
      ['restore', 'two'],
    ]);
    expect(db.fileTags(id)).toEqual([]); // the mirror still follows the disk
    expect(db.rejectedTags(id)).toEqual([]); // a person did not remove these
    expect(await readTags(path)).toEqual([]); // restoration is never silent
    expect(db.fileById(id)?.status).toBe('new');
  });

  it('a new inode with the same tags raises nothing', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['one']);
    await scan();
    await writeFile(`${path}.new`, 'saved');
    await writeTags(`${path}.new`, ['extra', 'one']);
    await rename(`${path}.new`, path);
    const result = await scan();
    expect(result.restores).toBe(0);
    expect(db.listReviews()).toEqual([]);
  });

  it('the same inode with fewer tags is a person: human tags go quietly', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['one', 'two']);
    await scan();
    await tick();
    await writeTags(path, ['one']);
    const result = await scan();
    expect(result.restores).toBe(0);
    expect(db.listReviews()).toEqual([]);
    expect(db.rejectedTags(db.fileByPath(path)!.id)).toEqual([]);
  });

  it('an AI tag removed by a person gets a rejected tombstone', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['ai-tag', 'human']);
    await scan();
    const id = db.fileByPath(path)!.id;
    db.addFileTags(id, ['ai-tag'], true);
    await tick();
    await writeTags(path, ['human']);
    await scan();
    expect(db.rejectedTags(id)).toEqual(['ai-tag']);
    expect(db.listReviews()).toEqual([]);
  });

  it('drops the item once the tag is back on the file', async () => {
    const path = await put('a.txt');
    await writeTags(path, ['one', 'two']);
    await scan();
    await saveByRename(path);
    await scan();
    await tick();
    await writeTags(path, ['one']);
    await scan();
    expect(db.listReviews().map((row) => row.tag)).toEqual(['two']);
  });
});

describe('recordWrite', () => {
  it('stops the app reacting to its own write', async () => {
    const path = await put('a.txt');
    await scan();
    const id = db.fileByPath(path)!.id;
    db.setFileResult(id, { status: 'organized' });
    await tick();
    await writeTags(path, ['mine']);
    db.addFileTags(id, ['mine'], true);
    await recordWrite(db, path);
    const result = await scan();
    expect(result.ids).toEqual([]);
    expect(db.fileTags(id)).toEqual([{ tag: 'mine', ai: true }]);
    expect(db.fileById(id)?.status).toBe('organized');
  });
});

describe('scanPaths', () => {
  it('updates a changed file and skips excluded and unchanged ones', async () => {
    const path = await put('a.txt');
    const quiet = await put('b.txt');
    await scan();
    await tick();
    await writeTags(path, ['t']);
    const secret = await put('.env');
    const result = await scanPaths(db, config, root, [path, quiet, secret]);
    expect(result).toMatchObject({ needsWalk: false, ids: [db.fileByPath(path)!.id] });
    expect(db.fileByPath(secret)).toBeUndefined();
  });

  it('moves a row when the rename arrives in one batch', async () => {
    const path = await put('a.txt');
    await scan();
    const id = db.fileByPath(path)!.id;
    await rename(path, at('b.txt'));
    await scanPaths(db, config, root, [path, at('b.txt')]);
    expect(db.fileById(id)?.path).toBe(at('b.txt'));
  });

  it('asks for a walk for a directory or a vanished indexed file, but not for a stray temp', async () => {
    const path = await put('dir/a.txt');
    await scan();
    expect((await scanPaths(db, config, root, [dirname(path)])).needsWalk).toBe(true);
    expect((await scanPaths(db, config, root, [root])).needsWalk).toBe(true);
    expect((await scanPaths(db, config, root, [at('never-existed')])).needsWalk).toBe(false);
    await rm(path);
    expect((await scanPaths(db, config, root, [path])).needsWalk).toBe(true);
    await rm(dirname(path), { recursive: true });
    expect((await scanPaths(db, config, root, [dirname(path)])).needsWalk).toBe(true);
  });
});
