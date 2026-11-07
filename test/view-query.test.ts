import { describe, expect, it, test } from 'vitest';
import { RETIRED_SCREENS, SCREENS } from '../src/web/screens.ts';
import { parseView, patchQuery, sortOf, titleOf, toFileQuery } from '../src/web/view-query.ts';

const SCOPE = { show_dotfiles: false, include_subfolders: true };
const params = (query: string) => Object.fromEntries(new URLSearchParams(query));

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

  test('are the six of the rail, each with its own shortcut, and title their tab', () => {
    expect(SCREENS.map((s) => s.id)).toEqual([
      'browse',
      'folders',
      'tags',
      'dashboard',
      'facets',
      'settings',
    ]);
    const keys = [...SCREENS, ...Object.values(RETIRED_SCREENS)].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(titleOf('screen=tags')).toBe('Tags');
    expect(titleOf('screen=folders')).toBe('Folders');
  });
});

describe('old addresses', () => {
  test.each([
    ['screen=organize', 'tags', 'organize'],
    ['screen=review', 'tags', 'review'],
    ['screen=names', 'tags', 'names'],
    ['screen=activity', 'dashboard', 'history'],
    ['screen=activity&section=applied', 'dashboard', 'history'],
  ])('%s opens the screen that took it in', (query, screen, section) => {
    expect(parseView(query)).toMatchObject({ screen, section });
  });

  test('keep the rest of the view', () => {
    expect(parseView('screen=review&tag=topic:tax&folder=/a')).toMatchObject({
      screen: 'tags',
      section: 'review',
      tag: ['topic:tax'],
      folder: '/a',
    });
  });

  test('a virtual folder in Files opens on the Folders screen', () => {
    expect(parseView('vfolder=3&vname=Tax')).toMatchObject({
      screen: 'folders',
      vfolder: '3',
      vname: 'Tax',
    });
    expect(parseView('screen=browse&vfolder=3').screen).toBe('folders');
    expect(parseView('screen=tags&vfolder=3').screen).toBe('tags');
    expect(titleOf('screen=browse&vfolder=3&vname=Tax')).toBe('Folders');
  });

  test('are written back in the new form only', () => {
    expect(params(patchQuery('screen=review', { tag: ['a:b'] }))).toEqual({
      screen: 'tags',
      section: 'review',
      tag: 'a:b',
    });
    expect(params(patchQuery('screen=activity', {}))).toEqual({
      screen: 'dashboard',
      section: 'history',
    });
    expect(params(patchQuery('', { vfolder: '3' }))).toEqual({ screen: 'folders', vfolder: '3' });
    expect(patchQuery('screen=folders&vfolder=3', { screen: 'browse', vfolder: null })).toBe('');
  });
});

describe('the Dashboard', () => {
  test('keeps its period and plan filter in params of their own, apart from the section', () => {
    const view = parseView('screen=dashboard&section=history&period=7&plans=applied');
    expect(view).toMatchObject({ section: 'history', period: '7', plans: 'applied' });
    expect(params(patchQuery('screen=dashboard', { plans: 'undone' }))).toEqual({
      screen: 'dashboard',
      plans: 'undone',
    });
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
