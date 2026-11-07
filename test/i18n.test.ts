import { afterEach, describe, expect, test } from 'vitest';
import { getLanguage, setLanguage, t } from '../src/web/i18n/index.ts';
import { dashboard } from '../src/web/i18n/dashboard.ts';
import { favorites } from '../src/web/i18n/favorites.ts';
import { folders } from '../src/web/i18n/folders.ts';
import { guide } from '../src/web/i18n/guide.ts';
import { shell } from '../src/web/i18n/shell.ts';
import { views as viewCatalog } from '../src/web/i18n/views.ts';
import { facets } from '../src/web/i18n/facets.ts';
import { settings } from '../src/web/i18n/settings.ts';
import { organize } from '../src/web/i18n/organize.ts';
import { names } from '../src/web/i18n/names.ts';
import { refresh } from '../src/web/i18n/refresh.ts';
import { tags } from '../src/web/i18n/tags.ts';

afterEach(() => setLanguage('en'));

/** The screen copy, split by area; the areas must not share a key either. */
const views = { ...viewCatalog, ...facets, ...settings, ...organize, ...names };

const slots = (text: string) =>
  [...text.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1]!)
    .toSorted((a, b) => a.localeCompare(b));

describe('interface translations', () => {
  test('every catalog preserves interpolation fields in Japanese and Chinese', () => {
    for (const [key, translations] of Object.entries({
      ...shell,
      ...views,
      ...guide,
      ...refresh,
      ...folders,
      ...favorites,
      ...tags,
      ...dashboard,
    })) {
      for (const text of translations) {
        expect({ key, text: text.trim() }).not.toEqual({ key, text: '' });
        expect({ key, slots: slots(text) }).toEqual({ key, slots: slots(key) });
      }
    }
  });

  test('shared messages are defined once across views and controls', () => {
    const areas: Record<string, readonly string[]>[] = [
      viewCatalog,
      facets,
      settings,
      organize,
      names,
    ];
    areas.forEach((area, index) => {
      const earlier = areas.slice(0, index);
      const clashes = Object.keys(area).filter((key) => earlier.some((e) => Object.hasOwn(e, key)));
      expect(clashes).toEqual([]);
    });
    expect(Object.keys(views).filter((key) => Object.hasOwn(shell, key))).toEqual([]);
    expect(
      Object.keys(guide).filter((key) => Object.hasOwn(shell, key) || Object.hasOwn(views, key)),
    ).toEqual([]);
    const shared = { ...shell, ...views, ...guide };
    expect(Object.keys(refresh).filter((key) => Object.hasOwn(shared, key))).toEqual([]);
    const before = { ...shared, ...refresh };
    expect(Object.keys(folders).filter((key) => Object.hasOwn(before, key))).toEqual([]);
    const withFolders = { ...before, ...folders };
    expect(Object.keys(favorites).filter((key) => Object.hasOwn(withFolders, key))).toEqual([]);
    const withFavorites = { ...withFolders, ...favorites };
    expect(Object.keys(tags).filter((key) => Object.hasOwn(withFavorites, key))).toEqual([]);
    const withTags = { ...withFavorites, ...tags };
    expect(Object.keys(dashboard).filter((key) => Object.hasOwn(withTags, key))).toEqual([]);
  });

  test('explicit language overrides the PC preference and system restores it', () => {
    setLanguage('system', 'ja');
    expect(getLanguage()).toBe('ja');
    expect(t('Settings')).toBe('設定');
    setLanguage('zh-CN', 'ja');
    expect(t('Settings')).toBe('设置');
    setLanguage('en', 'ja');
    expect(t('Settings')).toBe('Settings');
    setLanguage('system', 'zh-CN');
    expect(getLanguage()).toBe('zh-CN');
    setLanguage('invalid');
    expect(getLanguage()).toBe('en');
  });

  test('a key that would clash with another carries its own English text', () => {
    expect(t('Folders (virtual)')).toBe('Folders');
    expect(t('Questions (screen)')).toBe('Questions');
    setLanguage('ja');
    expect(t('Folders (virtual)')).toBe('仮想フォルダー');
    expect(t('Questions (screen)')).toBe('分類項目');
    expect(t('Folders')).toBe('フォルダー');
  });

  test('interpolated file and tag text stays literal, including translation keys and placeholders', () => {
    setLanguage('ja');
    const title = 'Settings {title} <script> \u001b]0;pwned\u0007';
    expect(t('Close {title}', { title })).toBe(`${title}を閉じる`);
  });

  test('unknown runtime keys cannot crash translated interfaces or read object prototypes', () => {
    setLanguage('ja');
    for (const key of ['attacker', 'toString', '__proto__']) expect(t(key as never)).toBe(key);
  });
});
