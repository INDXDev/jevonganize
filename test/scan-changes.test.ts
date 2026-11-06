import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/scan.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import {
  at,
  config,
  db,
  home,
  indexed,
  put,
  saveByRename,
  scan,
  tick,
  setupScanLibrary,
} from './scan-helpers.ts';

setupScanLibrary();

describe('fingerprints of unchanged files and tag edits', () => {
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

  // Windows only: elsewhere an overwrite keeps the attribute, and streams exist only there.
  it.runIf(process.platform === 'win32')(
    'an overwrite that drops the stream raises restore items, and is no person',
    async () => {
      const path = await put('a.txt');
      await writeTags(path, ['kept', 'ai']);
      await scan();
      const id = db.fileByPath(path)!.id;
      db.addFileTags(id, ['ai'], true);
      await tick();
      await writeFile(path, 'saved over');
      expect((await scan()).restores).toBe(2);
      expect(db.fileTags(id)).toEqual([]);
      expect(db.rejectedTags(id)).toEqual([]);
    },
  );

  // Windows only: this is a raw stream removal, which moves ctime and no other time.
  it.runIf(process.platform === 'win32')(
    'sees a stream another program removed, by ctime',
    async () => {
      const path = await put('a.txt');
      await writeTags(path, ['a']);
      await scan();
      await tick();
      await unlink(`${path}:jevonganize.tags`);
      expect((await scan()).changed).toBe(1);
      expect(db.fileTags(db.fileByPath(path)!.id)).toEqual([]);
    },
  );
});

describe('fingerprints of edits, renames and deletions', () => {
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
});

describe('fingerprints of removed and unreadable rows', () => {
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
});

describe('lost tags a person removed or put back', () => {
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
