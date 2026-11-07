import { describe, expect, it } from 'vitest';
import { addFile, db, native, tagged, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

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
    tagged(native('/lib/a'), ['doc-type:invoice', 'plain']);
    tagged(native('/lib/b'), ['doc-type:invoice']);
    tagged(native('/other/c'), ['plain']);
    db.setTagFacets([{ id: 'doc-type', weight: 1.5 }]);
    expect(db.tagCounts()).toEqual([
      { tag: 'doc-type:invoice', facet: 'doc-type', count: 2 },
      { tag: 'plain', facet: null, count: 2 },
    ]);
    expect(db.tagCounts({ folder: native('/other') }).map((row) => row.tag)).toEqual(['plain']);
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

describe('similarity invalidation', () => {
  it('skips unchanged scans and provenance changes, but refreshes memberships, counts and weights', () => {
    const id = tagged('/a', ['project:x']);
    expect(db.refreshIdf()).toBe(true);
    expect(db.refreshIdf()).toBe(false);
    db.setTagFacets([{ id: 'project', weight: 2 }]);
    expect(db.refreshIdf()).toBe(true);
    db.setTagFacets([{ id: 'project', weight: 2 }]);
    db.addFileTags(id, ['project:x'], true);
    db.addLibrary('/');
    db.markScanned('/');
    db.setFileResult(id, { status: 'organized' });
    expect(db.refreshIdf()).toBe(false);
    const before = db.fileById(id)!.tag_w;
    const other = addFile('/b');
    expect(db.refreshIdf()).toBe(true);
    expect(db.fileById(id)!.tag_w).toBeGreaterThan(before);
    db.addFileTags(other, ['project:x'], false);
    expect(db.refreshIdf()).toBe(true);
    db.removeFileTags(other, ['project:x']);
    expect(db.refreshIdf()).toBe(true);
    db.deleteFile(other);
    expect(db.refreshIdf()).toBe(true);
  });

  it('rolls back the dirty flag and rebuilt weights together', () => {
    const id = tagged('/a', ['t']);
    db.refreshIdf();
    const before = db.fileById(id)!.tag_w;
    expect(() =>
      db.transaction(() => {
        addFile('/b');
        expect(db.refreshIdf()).toBe(true);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(db.fileById(id)!.tag_w).toBe(before);
    expect(db.refreshIdf()).toBe(false);
  });
});
