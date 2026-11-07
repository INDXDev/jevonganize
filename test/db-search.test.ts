import { describe, expect, it } from 'vitest';
import { addFile, db, native, found, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

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

describe('searchFiles by text', () => {
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
});

describe('searchFiles by folder', () => {
  it('scopes to a folder, not a sibling with the same prefix', () => {
    addFile(native('/lib/a'));
    addFile(native('/lib/sub/b'));
    addFile(native('/lib-2/c'));
    expect(found({ folder: '/lib' })).toEqual(['/lib/a', '/lib/sub/b']);
    expect(found({ folder: '/lib/' })).toEqual(['/lib/a', '/lib/sub/b']);
  });

  it('stays directly in a folder when asked', () => {
    addFile(native('/lib/a'));
    addFile(native('/lib/sub/b'));
    addFile(native('/lib/😀/c'));
    expect(found({ folder: '/lib', direct_only: true })).toEqual(['/lib/a']);
    expect(found({ folder: '/lib/sub', direct_only: true })).toEqual(['/lib/sub/b']);
  });

  it('hides dotfiles and dot folders, but not a library inside a dot folder', () => {
    db.addLibrary(native('/lib'));
    db.addLibrary(native('/home/.config/app'));
    for (const path of [
      '/lib/a',
      '/lib/.env-like',
      '/lib/.cache/b',
      '/lib/sub/.c',
      '/home/.config/app/d',
      '/home/.config/app/.e',
      '/gone/.x/f',
    ])
      addFile(native(path));
    expect(found({ hide_dotfiles: true, sort: 'name' })).toEqual(['/lib/a', '/home/.config/app/d']);
    expect(found({ sort: 'name' })).toHaveLength(7);
  });
});

describe('searchFiles by kind, and folder counts', () => {
  it('sorts by kind, with unknown types first', () => {
    for (const [path, mime] of [
      ['/lib/b.png', 'image/png'],
      ['/lib/c.pdf', 'application/pdf'],
    ] as const)
      db.upsertFile(
        { path, dev: '1', ino: path, size: 1, mtime_ns: '1', ctime_ns: '1' },
        { edited: false, mime },
      );
    addFile('/lib/a');
    expect(found({ sort: 'kind' })).toEqual(['/lib/a', '/lib/c.pdf', '/lib/b.png']);
  });

  it('counts the folders directly under a folder', () => {
    addFile(native('/lib/a'));
    addFile(native('/lib/sub/b'));
    addFile(native('/lib/sub/deep/c'));
    addFile(native('/lib/Zeta/d'));
    addFile(native('/lib-2/skip/e'));
    expect(db.folderCounts(native('/lib'))).toEqual([
      { name: 'sub', path: native('/lib/sub'), files: 2 },
      { name: 'Zeta', path: native('/lib/Zeta'), files: 1 },
    ]);
    expect(db.folderCounts(native('/lib/sub/deep'))).toEqual([]);
  });
});

describe('searchFiles by type, with sorting and paging', () => {
  it('filters by mime glob and status', () => {
    db.setFileResult(addFile('/a'), { status: 'organized', mime: 'image/png' });
    db.setFileResult(addFile('/b'), { status: 'new', mime: 'application/pdf' });
    expect(found({ mime: 'image/*' })).toEqual(['/a']);
    expect(found({ mime: 'application/pdf' })).toEqual(['/b']);
    expect(found({ status: 'organized' })).toEqual(['/a']);
  });

  it('sorts by base name, size and time, and pages', () => {
    addFile(native('/z/a'), 3, 1000);
    addFile(native('/a/C'), 1, 3000);
    addFile(native('/m/b'), 2, 2000);
    expect(found({})).toEqual(['/z/a', '/m/b', '/a/C']);
    expect(found({ sort: 'name', order: 'desc' })).toEqual(['/a/C', '/m/b', '/z/a']);
    expect(found({ sort: 'size' })).toEqual(['/z/a', '/m/b', '/a/C']);
    expect(found({ sort: 'modified', order: 'asc' })).toEqual(['/z/a', '/m/b', '/a/C']);
    expect(db.searchFiles({ limit: 1, offset: 1 })).toMatchObject({
      total: 3,
      files: [{ path: native('/m/b') }],
    });
  });
});

describe('cached search totals', () => {
  it('reuses totals across pages and invalidates local updates and rollbacks', () => {
    const a = addFile('/a');
    expect(db.searchFiles({ limit: 1 }).total).toBe(1);
    expect(db.searchFiles({ offset: 1, limit: 1, sort: 'size' }).total).toBe(1);
    expect(() =>
      db.transaction(() => {
        addFile('/b');
        expect(db.searchFiles({}).total).toBe(2);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(db.searchFiles({}).total).toBe(1);
    expect(db.searchFiles({ status: 'organized' }).total).toBe(0);
    db.setFileResult(a, { status: 'organized' });
    expect(db.searchFiles({ status: 'organized' }).total).toBe(1);
    db.setContent(a, 'searchable content');
    expect(db.searchFiles({ text: 'searchable' }).total).toBe(1);
    db.setContent(a, 'different text');
    expect(db.searchFiles({ text: 'searchable' }).total).toBe(0);
  });
});
