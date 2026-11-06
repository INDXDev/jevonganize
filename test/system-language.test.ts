import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import bplist from 'bplist-creator';
import koffi from 'koffi';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn<typeof execFileSync>() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn<typeof readFileSync>() }));
vi.mock('koffi', () => ({ default: { load: vi.fn<typeof koffi.load>() } }));

const originalProcess = process;
const platform = (value: string) =>
  vi.stubGlobal('process', Object.create(originalProcess, { platform: { value } }));
const plist = (value: object) => bplist(value) as Buffer<ArrayBuffer>;
const detect = async () => (await import('../src/core/system-language.ts')).systemLanguage();

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error('no plist');
  });
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANGUAGE', 'LANG']) vi.stubEnv(key, '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('PC language', () => {
  test('macOS reads the preferred language from its plist, with no process', async () => {
    platform('darwin');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.mocked(readFileSync).mockReturnValue(plist({ AppleLanguages: ['ja-JP', 'en-US'] }));
    expect(await detect()).toBe('ja');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test.each([
    ['no list', { AppleLocale: 'ja_JP' }],
    ['an empty list', { AppleLanguages: [] }],
    ['a list of something else', { AppleLanguages: [1] }],
  ])('macOS asks `defaults` when the plist has %s', async (_name, value) => {
    platform('darwin');
    vi.mocked(readFileSync).mockReturnValue(plist(value));
    vi.mocked(execFileSync).mockReturnValue('(\n    "zh-Hans-CN"\n)\n');
    expect(await detect()).toBe('zh-CN');
  });

  test('macOS uses the preferred UI language even when the terminal locale is English', async () => {
    platform('darwin');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.mocked(execFileSync).mockReturnValue('(\n    "ja-JP",\n    "en-US"\n)\n');
    expect(await detect()).toBe('ja');
    expect(execFileSync).toHaveBeenCalledWith(
      '/usr/bin/defaults',
      ['read', '-g', 'AppleLanguages'],
      expect.objectContaining({ timeout: 1000, maxBuffer: 16_384 }),
    );
    vi.mocked(execFileSync).mockReturnValue('(\n    "en-US"\n)\n');
    expect(await detect()).toBe('ja');
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  test.each([
    [0x0411, 'ja'],
    [0x0804, 'zh-CN'],
    [0x0404, 'zh-CN'],
    [0x0409, 'en'],
    [0x040c, 'en'],
  ])('Windows reads the native UI language ID %s', async (id, expected) => {
    platform('win32');
    const read = vi.fn<() => number>(() => id);
    const func = vi.fn<() => typeof read>(() => read);
    vi.mocked(koffi.load).mockReturnValue({ func } as unknown as ReturnType<typeof koffi.load>);
    expect(await detect()).toBe(expected);
    expect(koffi.load).toHaveBeenCalledWith('kernel32.dll');
    expect(func).toHaveBeenCalledWith('uint16_t __stdcall GetUserDefaultUILanguage()');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('Linux respects the session locale and never runs a command', async () => {
    platform('linux');
    vi.stubEnv('LC_ALL', 'zh_CN.UTF-8');
    vi.stubEnv('LC_MESSAGES', 'ja_JP.UTF-8');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    expect(await detect()).toBe('zh-CN');
    expect(execFileSync).not.toHaveBeenCalled();
    expect(koffi.load).not.toHaveBeenCalled();
  });

  test('Linux supports desktop LANGUAGE preference lists', async () => {
    platform('linux');
    vi.stubEnv('LANGUAGE', 'ja_JP:en_US');
    vi.stubEnv('LC_MESSAGES', 'en_US.UTF-8');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    expect(await detect()).toBe('ja');
  });

  test.each(['C', 'POSIX', 'C.UTF-8'])(
    'Linux %s locale keeps the untranslated interface',
    async (locale) => {
      platform('linux');
      vi.stubEnv('LC_ALL', locale);
      vi.stubEnv('LANGUAGE', 'ja:zh');
      expect(await detect()).toBe('en');
    },
  );

  test('native detection failures use the session locale', async () => {
    platform('darwin');
    vi.stubEnv('LC_MESSAGES', 'zh_TW.UTF-8');
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('restricted');
    });
    expect(await detect()).toBe('zh-CN');
  });

  test.each(['fr-FR', 'de_DE.UTF-8', 'C', 'POSIX', ''])(
    'unsupported %s falls back to English',
    async (locale) => {
      const { supportedLanguage } = await import('../src/core/system-language.ts');
      expect(supportedLanguage(locale)).toBe('en');
    },
  );
});
