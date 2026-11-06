import { execFileSync } from 'node:child_process';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paths, UserError } from '../src/core/config.ts';
import { recordWrite, scanLibrary, scanPaths } from '../src/core/scan.ts';
import { writeTags } from '../src/core/tags.ts';
import {
  at,
  config,
  db,
  home,
  indexed,
  put,
  root,
  scan,
  setConfig,
  setRoot,
  tick,
  setupScanLibrary,
} from './scan-helpers.ts';

setupScanLibrary();

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
    setConfig({ exclude: ['!.env', '!*.pem', '!.ssh/', '!.ssh/config'] });
    const result = await scan();
    expect(indexed()).toEqual(['credentials-for-visa.pdf', 'deck.key']);
    expect(result.skipped).toBeGreaterThan(0);
  });
});

describe('walking with exclusions and missing roots', () => {
  it('keeps secrets out when the library sits inside a secret folder', async () => {
    setRoot(join(home(), '.ssh'));
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
    setConfig({ exclude: ['/Archive'] });
    await scan();
    expect(indexed()).toEqual(['a.tmp', 'keep.txt', 'node_modules/x.js']);
  });

  it('never indexes its own config, data or cache, even from a home-sized library', async () => {
    setRoot(home());
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
});

describe('walking what it cannot read, and progress', () => {
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
