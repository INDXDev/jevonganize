import { describe, expect, it } from 'vitest';
import { addFile, db, tagged, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

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
