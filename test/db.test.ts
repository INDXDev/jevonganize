import { DatabaseSync } from 'node:sqlite';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { paths, UserError } from '../src/core/config.ts';
import { openDb } from '../src/core/db.ts';
import type { Db } from '../src/core/db.ts';
import type { Answer, Plan } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

const home = useTempHome();
let db: Db;

const addFile = (path: string, size = 1, mtimeMs = 1000) =>
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

const tagged = (path: string, tags: string[]) => {
  const id = addFile(path);
  db.addFileTags(id, tags, false);
  return id;
};

const found = (query: Parameters<Db['searchFiles']>[0]) =>
  db.searchFiles(query).files.map((file) => file.path);

const item = (file_id: number, tag: string, confidence: number | null = 0.6) =>
  ({ file_id, kind: 'suggest', tag, confidence, reason: 'r' }) as const;

const plan = (id: string, created_at: number, status: Plan['status'] = 'proposed'): Plan => ({
  id,
  title: 'title',
  source: 'user',
  status,
  created_at,
  ops: [{ file_id: 1, add: ['a'], remove: [] }],
  summary: { files: 1, added: { a: 1 }, removed: {} },
});

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('plan claims', () => {
  it('only one of two connections gets a plan', () => {
    const file = join(home(), 'index.db');
    const one = openDb(file);
    const two = openDb(file);
    one.savePlan(plan('p', 1));
    expect(one.claimPlan('p', 1000)).toBe(true);
    expect(two.claimPlan('p', 1000)).toBe(false);
    expect(two.getPlan('p')?.status).toBe('applying');
    one.close();
    two.close();
  });

  it('gives back only claims older than the limit', () => {
    db.savePlan(plan('old', 1));
    db.savePlan(plan('new', 2));
    db.claimPlan('old', 1000);
    db.claimPlan('new', 5000);
    db.releasePlans(2000);
    expect(db.getPlan('old')?.status).toBe('proposed');
    expect(db.listPlans('applying').map(({ id }) => id)).toEqual(['new']);
  });
});

describe('openDb', () => {
  it('creates the default index in WAL mode, in a 0700 directory', async () => {
    const opened = openDb();
    expect(opened.schemaVersion()).toBe(2);
    opened.close();
    const raw = new DatabaseSync(paths.database());
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    raw.close();
    expect((await stat(join(home(), 'data'))).mode & 0o777).toBe(0o700);
  });

  it('migrates a version 1 index, keeping its data', () => {
    const file = join(home(), 'index.db');
    const first = openDb(file);
    first.addLibrary('/lib');
    first.close();
    const raw = new DatabaseSync(file);
    raw.exec(`DROP INDEX file_name; DROP TABLE plan_op; ALTER TABLE plan DROP COLUMN claimed_at;
      PRAGMA user_version = 1`);
    raw.close();
    const second = openDb(file);
    expect(second.schemaVersion()).toBe(2);
    expect(second.listLibraries().map((library) => library.path)).toEqual(['/lib']);
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
    db.addLibrary('/lib');
    db.addLibrary('/lib');
    addFile('/lib/a');
    addFile('/lib-other/b');
    db.markScanned('/lib');
    const [library] = db.listLibraries();
    expect(library?.files).toBe(1);
    expect(library?.scanned_at).toBeGreaterThan(0);
  });

  it('removing one forgets its files, but not those inside another library', () => {
    db.addLibrary('/lib');
    db.addLibrary('/lib/inner');
    addFile('/lib/a');
    const inner = addFile('/lib/inner/b');
    db.removeLibrary('/lib');
    expect(db.fileByPath('/lib/a')).toBeUndefined();
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

describe('searchFiles at scale', () => {
  const FILES = 5000;

  // Rescanning the index per file row took 12 s here, and 5,018 s at 100,000 files.
  it.each(['commonword', 'zz'])(
    'a text query hitting every file reads the index once: %s',
    (text) => {
      db.transaction(() => {
        for (let n = 0; n < FILES; n++) {
          db.setContent(
            addFile(`/lib/file-${n}.txt`),
            `commonword zz ${'lorem ipsum '.repeat(40)}`,
          );
        }
      });
      const started = performance.now();
      const { files, total } = db.searchFiles({ text, limit: 50 });
      expect(performance.now() - started).toBeLessThan(2000);
      expect(total).toBe(FILES);
      expect(files).toHaveLength(50);
    },
    120_000,
  );
});

describe('searchFiles', () => {
  it('finds content by trigram, including a Japanese substring', () => {
    db.setContent(addFile('/a'), '東京都の請求書です');
    db.setContent(addFile('/b'), 'nothing here');
    expect(found({ text: '請求書' })).toEqual(['/a']);
  });

  it('falls back to LIKE under 3 characters', () => {
    db.setContent(addFile('/a'), '東京都の請求書です');
    db.setContent(addFile('/b'), 'other');
    expect(found({ text: '東京' })).toEqual(['/a']);
  });

  it('matches file names at any length, and escapes LIKE and MATCH syntax', () => {
    addFile('/lib/invoice_44.pdf');
    addFile('/lib/invoiceX44.pdf');
    db.setContent(addFile('/lib/quote'), 'say "hello" to');
    expect(found({ text: 'invoice_44' })).toEqual(['/lib/invoice_44.pdf']);
    expect(found({ text: '%' })).toEqual([]);
    expect(found({ text: '"hello"' })).toEqual(['/lib/quote']);
    expect(found({ text: 'a OR b*' })).toEqual([]);
  });

  it('ranks content hits by relevance, then name-only hits', () => {
    db.setContent(addFile('/lib/one'), 'acme acme acme');
    db.setContent(addFile('/lib/two'), `acme ${'filler '.repeat(50)}`);
    addFile('/lib/acme-name');
    expect(found({ text: 'acme' })).toEqual(['/lib/one', '/lib/two', '/lib/acme-name']);
  });

  it('scopes to a folder, not a sibling with the same prefix', () => {
    addFile('/lib/a');
    addFile('/lib/sub/b');
    addFile('/lib-2/c');
    expect(found({ folder: '/lib' })).toEqual(['/lib/a', '/lib/sub/b']);
    expect(found({ folder: '/lib/' })).toEqual(['/lib/a', '/lib/sub/b']);
  });

  it('matches tags with their children, and all of them', () => {
    tagged('/parent', ['topic:finance']);
    tagged('/child', ['topic:finance/tax', 'year:2024']);
    tagged('/sibling', ['topic:finance-law']);
    expect(found({ tags: ['topic:finance'] })).toEqual(['/child', '/parent']);
    expect(found({ tags: ['topic:finance', 'year:2024'] })).toEqual(['/child']);
    expect(found({ tags: ['Topic:finance'] })).toEqual([]);
  });

  it('treats - as a child boundary only after a year', () => {
    tagged('/month', ['doc-date:2026-03']);
    tagged('/year', ['doc-date:2026']);
    tagged('/other', ['doc-date:20260']);
    expect(found({ tags: ['doc-date:2026'] })).toEqual(['/month', '/year']);
  });

  it('excludes tags with their children', () => {
    tagged('/child', ['topic:finance/tax']);
    tagged('/kept', ['topic:law']);
    addFile('/untagged');
    expect(found({ exclude_tags: ['topic:finance'] })).toEqual(['/kept', '/untagged']);
  });

  it('filters by mime glob and status', () => {
    db.setFileResult(addFile('/a'), { status: 'organized', mime: 'image/png' });
    db.setFileResult(addFile('/b'), { status: 'new', mime: 'application/pdf' });
    expect(found({ mime: 'image/*' })).toEqual(['/a']);
    expect(found({ mime: 'application/pdf' })).toEqual(['/b']);
    expect(found({ status: 'organized' })).toEqual(['/a']);
  });

  it('sorts by base name, size and time, and pages', () => {
    addFile('/z/a', 3, 1000);
    addFile('/a/C', 1, 3000);
    addFile('/m/b', 2, 2000);
    expect(found({})).toEqual(['/z/a', '/m/b', '/a/C']);
    expect(found({ sort: 'name', order: 'desc' })).toEqual(['/a/C', '/m/b', '/z/a']);
    expect(found({ sort: 'size' })).toEqual(['/z/a', '/m/b', '/a/C']);
    expect(found({ sort: 'modified', order: 'asc' })).toEqual(['/z/a', '/m/b', '/a/C']);
    expect(db.searchFiles({ limit: 1, offset: 1 })).toMatchObject({
      total: 3,
      files: [{ path: '/m/b' }],
    });
  });
});

describe('tags', () => {
  it('sync keeps ai on tags that stay, and reports what left', () => {
    const id = addFile('/a');
    db.addFileTags(id, ['ai-kept', 'ai-gone'], true);
    db.addFileTags(id, ['human-gone'], false);
    const { added, removed } = db.syncFileTags(id, ['ai-kept', 'new']);
    expect(added).toEqual(['new']);
    expect(removed).toEqual([
      { tag: 'ai-gone', ai: true },
      { tag: 'human-gone', ai: false },
    ]);
    expect(db.fileTags(id)).toEqual([
      { tag: 'ai-kept', ai: true },
      { tag: 'new', ai: false },
    ]);
  });

  it('accepting a tag from review can clear its ai flag', () => {
    const id = addFile('/a');
    db.addFileTags(id, ['t'], true);
    db.addFileTags(id, ['t'], false);
    expect(db.fileTags(id)).toEqual([{ tag: 't', ai: false }]);
  });

  it('counts tags, by folder and by facet', () => {
    tagged('/lib/a', ['doc-type:invoice', 'plain']);
    tagged('/lib/b', ['doc-type:invoice']);
    tagged('/other/c', ['plain']);
    db.setTagFacets([{ id: 'doc-type', weight: 1.5 }]);
    expect(db.tagCounts()).toEqual([
      { tag: 'doc-type:invoice', facet: 'doc-type', count: 2 },
      { tag: 'plain', facet: null, count: 2 },
    ]);
    expect(db.tagCounts({ folder: '/other' }).map((row) => row.tag)).toEqual(['plain']);
    expect(db.tagCounts({ facet: 'doc-type' })).toHaveLength(1);
    expect(db.filesWithTag('plain')).toHaveLength(2);
  });

  it('stamps flag tags, and leaves a longer facet id alone', () => {
    tagged('/a', ['flag:signed', 'signed:x', 'signed-off:y']);
    db.setTagFacets([{ id: 'signed', weight: 2 }]);
    expect(Object.fromEntries(db.tagCounts().map((row) => [row.tag, row.facet]))).toEqual({
      'flag:signed': 'signed',
      'signed:x': 'signed',
      'signed-off:y': null,
    });
  });
});

describe('similarFiles', () => {
  const weights = [
    { id: 'project', weight: 2 },
    { id: 'doc-type', weight: 1.5 },
    { id: 'status', weight: 0.5 },
    { id: 'language', weight: 0.25 },
    { id: 'year', weight: 1 },
  ];

  it('ranks the worked idea of docs/storage.md: rare, heavy tags beat common ones', () => {
    const a = tagged('/a', ['doc-type:invoice', 'status:reference', 'project:acme', 'language:en']);
    const b = tagged('/b', [
      'doc-type:contract',
      'status:reference',
      'project:acme',
      'language:en',
    ]);
    const c = tagged('/c', ['doc-type:invoice', 'status:reference', 'project:zeta', 'language:en']);
    for (let i = 0; i < 30; i++) tagged(`/filler${i}`, ['status:reference', 'language:en']);
    db.setTagFacets(weights);
    db.refreshIdf();
    const similar = db.similarFiles(a, 2);
    expect(similar.map((file) => file.id)).toEqual([b, c]);
    expect(similar[0]?.shared).toEqual(['language:en', 'project:acme', 'status:reference']);
    expect(similar[0]?.score).toBeGreaterThan(similar[1]!.score);
    expect(similar[0]?.score).toBeLessThan(1);
    expect(db.similarFiles(b, 1)[0]?.score).toBeCloseTo(similar[0]!.score); // symmetric
  });

  it('scores identical sets 1, skips zero-weight facets and untagged files', () => {
    const a = tagged('/a', ['year:2024', 'ignored:x']);
    tagged('/b', ['year:2024', 'ignored:x']);
    const c = tagged('/c', ['ignored:x']);
    const none = addFile('/d');
    db.setTagFacets([{ id: 'ignored', weight: 0 }]);
    db.refreshIdf();
    expect(db.similarFiles(a).map((file) => file.score)).toEqual([1]);
    expect(db.similarFiles(c)).toEqual([]);
    expect(db.similarFiles(none)).toEqual([]);
  });

  it('computes idf as documented', () => {
    tagged('/a', ['t']);
    addFile('/b');
    addFile('/c');
    db.refreshIdf();
    const expected = Math.log(1 + (3 - 1 + 0.5) / (1 + 0.5));
    expect(db.fileByPath('/a')?.tag_w).toBeCloseTo(expected);
  });

  it('keeps tag_w right when a tag is removed between refreshes', () => {
    const id = tagged('/a', ['t', 'u']);
    db.refreshIdf();
    const before = db.fileById(id)!.tag_w;
    db.removeFileTags(id, ['u']);
    expect(db.fileById(id)!.tag_w).toBeCloseTo(before / 2);
  });
});

describe('answers', () => {
  const answer: Answer = {
    facet: 'f',
    value: 'v',
    confidence: 0.9,
    estimated: false,
    refused: false,
  };

  it('lets a new answer replace a stored one, so a corrupt row can heal', () => {
    db.putAnswer('k', 'f', []);
    db.putAnswer('k', 'f', [answer]);
    expect(db.getAnswer('k')).toEqual([answer]);
    expect(db.getAnswer('missing')).toBeUndefined();
  });

  it('links one key per file and facet', () => {
    const id = addFile('/a');
    db.putAnswer('k1', 'f', [answer]);
    db.putAnswer('k2', 'f', [{ ...answer, value: 'w' }]);
    db.linkAnswer(id, 'f', 'k1');
    db.linkAnswer(id, 'f', 'k2');
    expect(db.fileAnswers(id).map((row) => row.value)).toEqual(['w']);
  });

  it('counts a damaged row as a miss', () => {
    const file = join(home(), 'index.db');
    const opened = openDb(file);
    opened.putAnswer('bad', 'f', []);
    const raw = new DatabaseSync(file);
    raw.exec(`UPDATE answer SET body = '{oops'`);
    raw.close();
    expect(opened.getAnswer('bad')).toBeUndefined();
    opened.close();
  });
});

describe('reviews', () => {
  it('lists open items by tag, then confidence, nulls last', () => {
    const id = addFile('/a');
    const other = addFile('/b');
    const third = addFile('/c');
    db.addReview(item(id, 'b'));
    db.addReview(item(id, 'a', 0.5));
    db.addReview(item(other, 'a', 0.7));
    db.addReview(item(third, 'a', null));
    expect(db.listReviews().map((row) => [row.tag, row.confidence])).toEqual([
      ['a', 0.7],
      ['a', 0.5],
      ['a', null],
      ['b', 0.6],
    ]);
    expect(db.listReviews({ tag: 'b' })).toHaveLength(1);
    expect(db.listReviews({ limit: 2 })).toHaveLength(2);
    expect(db.stats().reviews).toBe(4);
  });

  it('a rejected suggestion stays as a tombstone, and a cached answer cannot revive it', () => {
    const id = addFile('/a');
    expect(db.addReview(item(id, 't'))).toBe(true);
    const [row] = db.listReviews();
    db.resolveReviews([row!.id], 'rejected');
    expect(db.listReviews()).toEqual([]);
    expect(db.rejectedTags(id)).toEqual(['t']);
    expect(db.addReview(item(id, 't'))).toBe(false);
    expect(db.listReviews()).toEqual([]);
  });

  it('a rejected restore item is deleted', () => {
    const id = addFile('/a');
    db.addReview({ ...item(id, 't'), kind: 'restore' });
    db.resolveReviews([db.listReviews()[0]!.id], 'rejected');
    expect(db.rejectedTags(id)).toEqual([]);
    expect(db.addReview({ ...item(id, 't'), kind: 'restore' })).toBe(true);
  });

  it('an accepted restore item goes too, so a second loss can raise one again', () => {
    const id = addFile('/a');
    db.addReview({ ...item(id, 't'), kind: 'restore' });
    db.resolveReviews([db.listReviews()[0]!.id], 'accepted');
    expect(db.addReview({ ...item(id, 't'), kind: 'restore' })).toBe(true);
    expect(db.listReviews()).toHaveLength(1);
  });

  it('accepting closes the item, and reviewsByIds still finds it', () => {
    const id = addFile('/a');
    db.addReview(item(id, 't'));
    const { id: review } = db.listReviews()[0]!;
    db.resolveReviews([review], 'accepted');
    expect(db.listReviews()).toEqual([]);
    expect(db.reviewsByIds([review, 999]).map((row) => row.tag)).toEqual(['t']);
    expect(db.rejectedTags(id)).toEqual([]);
  });

  it('rejectTag closes an open suggestion too', () => {
    const id = addFile('/a');
    db.addReview(item(id, 't'));
    db.rejectTag(id, 't', 'Removed by a person');
    db.rejectTag(id, 'u', 'Removed by a person');
    expect(db.reviewsForFile(id)).toEqual([]);
    expect(db.rejectedTags(id)).toEqual(['t', 'u']);
  });

  it('drops restore items whose tag is back, and only those', () => {
    const id = addFile('/a');
    db.addReview({ ...item(id, 'back'), kind: 'restore' });
    db.addReview({ ...item(id, 'lost'), kind: 'restore' });
    db.addReview(item(id, 'back'));
    db.dropRestored(id, ['back']);
    expect(db.reviewsForFile(id).map((row) => [row.kind, row.tag])).toEqual([
      ['suggest', 'back'],
      ['restore', 'lost'],
    ]);
  });
});

describe('plans', () => {
  it('round-trips a plan, and replaces it by id', () => {
    db.savePlan(plan('p', 1));
    expect(db.getPlan('p')).toEqual(plan('p', 1));
    db.savePlan(plan('p', 1, 'applied'));
    expect(db.getPlan('p')?.status).toBe('applied');
    expect(db.listPlans('proposed')).toEqual([]);
    expect(db.getPlan('missing')).toBeUndefined();
  });

  it('lists newest first with ops empty', () => {
    db.savePlan(plan('old', 1));
    db.savePlan(plan('new', 2, 'applied'));
    expect(db.listPlans().map((row) => row.id)).toEqual(['new', 'old']);
    expect(db.listPlans()[0]).toEqual({ ...plan('new', 2, 'applied'), ops: [] });
    expect(db.listPlans('applied')).toHaveLength(1);
    db.deletePlan('old');
    expect(db.listPlans()).toHaveLength(1);
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
