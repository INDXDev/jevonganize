import { DatabaseSync } from 'node:sqlite';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paths, UserError } from '../src/core/config.ts';
import { openDb } from '../src/core/db.ts';
import { addFile, db, found, home, native, tagged, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

describe('openDb', () => {
  it('creates the default index in WAL mode, in a 0700 directory', async () => {
    const opened = openDb();
    expect(opened.schemaVersion()).toBe(6);
    opened.close();
    const raw = new DatabaseSync(paths.database());
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    raw.close();
    if (process.platform === 'win32') return; // POSIX modes do not exist there
    expect((await stat(join(home(), 'data'))).mode & 0o777).toBe(0o700);
  });

  it('migrates a version 1 index, keeping its data', () => {
    const file = join(home(), 'index.db');
    const first = openDb(file);
    first.addLibrary('/lib');
    first.close();
    const raw = new DatabaseSync(file);
    for (const { name } of raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'similarity_%'")
      .all() as { name: string }[])
      raw.exec(`DROP TRIGGER ${name}`);
    raw.exec('DROP TABLE similarity_state');
    raw.exec(`DROP INDEX file_name; DROP TABLE plan_op; ALTER TABLE plan DROP COLUMN claimed_at;
      ALTER TABLE file DROP COLUMN extract_key; DROP TABLE vfolder;
      DROP TABLE favorite_tag; DROP TABLE usage; PRAGMA user_version = 1`);
    raw.close();
    const second = openDb(file);
    expect(second.schemaVersion()).toBe(6);
    expect(second.listLibraries().map((library) => library.path)).toEqual(['/lib']);
    second.close();
  });

  it('migrates a version 5 index to 6, keeping its data and adding favorites and usage', () => {
    const file = join(home(), 'index.db');
    const first = openDb(file);
    first.addLibrary('/lib');
    const rule = JSON.stringify({ tags: ['t'], tag_match: 'all', exclude_tags: [] });
    first.insertVfolder({ name: 'Taxes', parent: null, rule, tag: 't' }, 1);
    first.close();
    const raw = new DatabaseSync(file);
    raw.exec('DROP TABLE favorite_tag; DROP TABLE usage; PRAGMA user_version = 5');
    raw.close();
    const second = openDb(file);
    expect(second.schemaVersion()).toBe(6);
    expect(second.listLibraries().map((library) => library.path)).toEqual(['/lib']);
    expect(second.listVfolders().map((folder) => folder.name)).toEqual(['Taxes']);
    second.setFavoriteTag({ tag: 't', favorite: true });
    expect(second.listFavoriteTags().map((row) => row.tag)).toEqual(['t']);
    second.close();
  });

  it('indexes the name, in the order a name sort reads it', () => {
    const file = join(home(), 'index.db');
    openDb(file).close();
    const raw = new DatabaseSync(file);
    const row = raw
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'file_name'`)
      .get() as { sql: string } | undefined;
    raw.close();
    expect(row?.sql).toContain('COLLATE NOCASE');
  });
});

describe('openDb on an existing file', () => {
  it('reopens without migrating again, and keeps data', () => {
    const file = join(home(), 'index.db');
    const first = openDb(file);
    first.addLibrary('/lib');
    first.close();
    const second = openDb(file);
    expect(second.listLibraries().map((library) => library.path)).toEqual(['/lib']);
    second.close();
  });

  it('refuses a newer index, and leaves it unaltered', () => {
    const file = join(home(), 'index.db');
    const raw = new DatabaseSync(file);
    raw.exec('CREATE TABLE future (a); PRAGMA user_version = 99');
    raw.close();
    expect(() => openDb(file)).toThrow(UserError);
    const check = new DatabaseSync(file);
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 99 });
    expect(check.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
    check.close();
  });

  it('reports a file that is not a database', async () => {
    const file = join(home(), 'index.db');
    await writeFile(file, 'x'.repeat(5000));
    expect(() => openDb(file)).toThrow(UserError);
  });
});

describe('transaction', () => {
  it('rolls back on a throw, and joins an open transaction', () => {
    expect(() =>
      db.transaction(() => {
        db.transaction(() => db.addLibrary('/a'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.listLibraries()).toEqual([]);
  });
});

describe('libraries', () => {
  it('counts files, stamps scans and is idempotent', () => {
    db.addLibrary(native('/lib'));
    db.addLibrary(native('/lib'));
    addFile(native('/lib/a'));
    addFile(native('/lib-other/b'));
    db.markScanned(native('/lib'));
    const [library] = db.listLibraries();
    expect(library?.files).toBe(1);
    expect(library?.scanned_at).toBeGreaterThan(0);
  });

  it('removing one forgets its files, but not those inside another library', () => {
    db.addLibrary(native('/lib'));
    db.addLibrary(native('/lib/inner'));
    addFile(native('/lib/a'));
    const inner = addFile(native('/lib/inner/b'));
    db.removeLibrary(native('/lib'));
    expect(db.fileByPath(native('/lib/a'))).toBeUndefined();
    expect(db.fileById(inner)).toBeDefined();
  });
});

describe('files', () => {
  it('upserts by path, and looks up the fingerprint', () => {
    const id = addFile('/a', 5);
    expect(addFile('/a', 6)).toBe(id);
    expect(db.fileByPath('/a')).toMatchObject({ id, size: 6, status: 'new', ctime_ns: '1' });
    expect(db.filesByInode('1', '/a').map((row) => row.id)).toEqual([id]);
  });

  it('an edit clears what described the old content, a tag write does not', () => {
    const id = addFile('/a');
    db.setFileResult(id, { status: 'organized', hash: 'h', state_hash: 's', mime: 'text/plain' });
    addFile('/a');
    expect(db.fileById(id)).toMatchObject({ status: 'organized', hash: 'h', state_hash: 's' });
    const row = db.fileById(id)!;
    db.upsertFile(row, { edited: true });
    expect(db.fileById(id)).toMatchObject({
      status: 'new',
      hash: null,
      state_hash: null,
      mime: 'text/plain',
    });
  });

  it('keeps stored values that a result leaves out', () => {
    const id = addFile('/a');
    db.setFileResult(id, { status: 'organized', hash: 'h', metadata: { pages: 2 } });
    db.setFileResult(id, { status: 'failed', error: 'bad' });
    expect(db.fileById(id)).toMatchObject({ status: 'failed', error: 'bad', hash: 'h' });
    expect(db.fileDetail(id)?.metadata).toEqual({ pages: 2 });
  });
});

describe('file rows', () => {
  it('builds a FileRow', () => {
    const id = tagged('/lib/deep/name.txt', ['b', 'a,b']);
    expect(db.fileRow(id)).toEqual({
      id,
      path: '/lib/deep/name.txt',
      name: 'name.txt',
      size: 1,
      mtime_ms: 1000,
      mime: null,
      tags: ['a,b', 'b'],
      status: 'new',
    });
  });

  it('a delete leaves nothing behind, never reuses the id, and keeps answers', () => {
    const id = tagged('/a', ['t']);
    db.putAnswer('k', 'f', []);
    db.linkAnswer(id, 'f', 'k');
    db.setContent(id, 'hello world');
    db.addReview({ file_id: id, kind: 'suggest', tag: 'x', confidence: 0.6, reason: 'r' });
    db.deleteFile(id);
    expect(addFile('/b')).toBeGreaterThan(id); // an old plan must not reach a new file
    expect(db.fileTags(id)).toEqual([]);
    expect(db.fileAnswers(id)).toEqual([]);
    expect(db.reviewsForFile(id)).toEqual([]);
    expect(db.getContent(id)).toBeUndefined();
    expect(db.getAnswer('k')).toEqual([]);
  });

  it('moves a row, keeping its tags', () => {
    const id = tagged('/a', ['t']);
    db.moveFile(id, '/b');
    expect(db.fileRow(id)).toMatchObject({ path: '/b', name: 'b', tags: ['t'] });
  });
});

describe('vocabulary', () => {
  it('a proposal never overrides a decision', () => {
    db.setVocabulary('party', 'acme', 'retired');
    db.proposeVocabulary('party', 'acme');
    db.proposeVocabulary('party', 'zeta');
    db.setVocabulary('topic', 'tax', 'active');
    expect(db.listVocabulary('party')).toEqual([
      { facet: 'party', value: 'acme', state: 'retired' },
      { facet: 'party', value: 'zeta', state: 'proposed' },
    ]);
    expect(db.listVocabulary()).toHaveLength(3);
  });
});

describe('content', () => {
  it('replaces text for a file', () => {
    const id = addFile('/a');
    db.setContent(id, 'first version');
    db.setContent(id, 'second version');
    expect(db.getContent(id)).toBe('second version');
    expect(found({ text: 'first' })).toEqual([]);
  });
});

describe('stats', () => {
  it('counts files, organized files and tags in use', () => {
    const id = tagged('/a', ['t']);
    addFile('/b');
    db.setFileResult(id, { status: 'organized' });
    expect(db.stats()).toEqual({ files: 2, organized: 1, tags: 1, reviews: 0 });
  });
});
