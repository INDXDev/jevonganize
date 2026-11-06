import { describe, expect, it } from 'vitest';
import { addFile, db, found, native, tagged, setupMemoryDb } from './db-helpers.ts';

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

describe('searchFiles by tag', () => {
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

  it('needs every tag by default, and one of them with `any`', () => {
    tagged('/both', ['topic:finance/tax', 'project:acme']);
    tagged('/one', ['topic:finance']);
    tagged('/other', ['project:acme']);
    tagged('/neither', ['topic:law']);
    const tags = ['topic:finance', 'project:acme'];
    expect(found({ tags })).toEqual(['/both']);
    expect(found({ tags, tag_match: 'all' })).toEqual(['/both']);
    expect(found({ tags, tag_match: 'any' })).toEqual(['/both', '/one', '/other']);
  });

  it('keeps other filters and exclusions around an `any` match', () => {
    db.setFileResult(tagged('/a', ['x:1']), { status: 'new', mime: 'image/png' });
    db.setFileResult(tagged('/b', ['x:2', 'y:1']), { status: 'new', mime: 'image/png' });
    db.setFileResult(tagged('/c', ['x:2']), { status: 'new', mime: 'text/plain' });
    const query = { tags: ['x:1', 'x:2'], tag_match: 'any' as const };
    expect(found({ ...query, mime: 'image/*', exclude_tags: ['y:1'] })).toEqual(['/a']);
  });

  it('matches everything when `any` has no tags', () => {
    addFile('/a');
    expect(found({ tags: [], tag_match: 'any' })).toEqual(['/a']);
  });

  it('excludes tags with their children', () => {
    tagged('/child', ['topic:finance/tax']);
    tagged('/kept', ['topic:law']);
    addFile('/untagged');
    expect(found({ exclude_tags: ['topic:finance'] })).toEqual(['/kept', '/untagged']);
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
