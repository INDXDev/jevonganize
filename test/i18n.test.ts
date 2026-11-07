import { afterEach, describe, expect, test } from 'vitest';
import { getLanguage, setLanguage, t } from '../src/web/i18n/index.ts';
import { guide } from '../src/web/i18n/guide.ts';
import { shell } from '../src/web/i18n/shell.ts';
import { views } from '../src/web/i18n/views.ts';

afterEach(() => setLanguage('en'));

const slots = (text: string) =>
  [...text.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1]!)
    .toSorted((a, b) => a.localeCompare(b));

describe('interface translations', () => {
  test('every catalog preserves interpolation fields in Japanese and Chinese', () => {
    for (const [key, translations] of Object.entries({ ...shell, ...views, ...guide })) {
      for (const text of translations) {
        expect({ key, text: text.trim() }).not.toEqual({ key, text: '' });
        expect({ key, slots: slots(text) }).toEqual({ key, slots: slots(key) });
      }
    }
  });

  test('shared messages are defined once across views and controls', () => {
    expect(Object.keys(views).filter((key) => Object.hasOwn(shell, key))).toEqual([]);
    expect(
      Object.keys(guide).filter((key) => Object.hasOwn(shell, key) || Object.hasOwn(views, key)),
    ).toEqual([]);
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
