import { describe, expect, it } from 'vitest';
import { addFile, db, found, tagged, setupMemoryDb } from './db-helpers.ts';

setupMemoryDb();

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
