import { describe, expect, it, test } from 'vitest';
import {
  parseView,
  patchQuery,
  SCREENS,
  sortOf,
  titleOf,
  toFileQuery,
} from '../src/web/view-query.ts';

const SCOPE = { show_dotfiles: false, include_subfolders: true };

describe('tag matching', () => {
  test('starts on any, and leaves the default out of the address', () => {
    expect(parseView('').match).toBe('any');
    expect(patchQuery('match=all', { match: 'any' })).toBe('');
    expect(parseView(patchQuery('', { match: 'all' })).match).toBe('all');
  });

  test('reaches the query only when there is a choice to make', () => {
    expect(toFileQuery(parseView('tag=a:b'), SCOPE).tag_match).toBeUndefined();
    expect(toFileQuery(parseView('tag=a:b&tag=c:d'), SCOPE).tag_match).toBe('any');
    expect(toFileQuery(parseView('tag=a:b&tag=c:d&match=all'), SCOPE).tag_match).toBe('all');
  });
});

describe('screens', () => {
  test('an untrusted status cannot become a translated status key', () => {
    expect(parseView('status=attacker').status).toBeUndefined();
    expect(parseView('status=failed').status).toBe('failed');
  });
  test('an unknown screen falls back to the browser', () => {
    expect(parseView('screen=nowhere').screen).toBe('browse');
  });

  test('each has its own shortcut, and titles its tab', () => {
    expect(new Set(SCREENS.map((s) => s.key)).size).toBe(SCREENS.length);
    expect(titleOf('screen=organize')).toBe('Organize');
  });
});

describe('view options', () => {
  it('hides dotfiles unless asked', () => {
    expect(toFileQuery(parseView(''), SCOPE).hide_dotfiles).toBe(true);
    const shown = { ...SCOPE, show_dotfiles: true };
    expect(toFileQuery(parseView(''), shown).hide_dotfiles).toBeUndefined();
  });

  it('stays in a folder only while browsing it', () => {
    const scope = { ...SCOPE, include_subfolders: false };
    expect(toFileQuery(parseView('folder=/a'), scope).direct_only).toBe(true);
    expect(toFileQuery(parseView(''), scope).direct_only).toBeUndefined();
    expect(toFileQuery(parseView('folder=/a&text=x'), scope).direct_only).toBeUndefined();
    expect(toFileQuery(parseView('folder=/a&tag=a:b'), scope).direct_only).toBeUndefined();
  });

  it('reports the sort the index really uses', () => {
    expect(sortOf({})).toEqual({ sort: 'name', order: 'asc' });
    expect(sortOf({ text: 'x' })).toEqual({ sort: 'relevance', order: 'desc' });
    expect(sortOf({ sort: 'kind' })).toEqual({ sort: 'kind', order: 'asc' });
    expect(sortOf({ sort: 'size' })).toEqual({ sort: 'size', order: 'desc' });
  });
});
