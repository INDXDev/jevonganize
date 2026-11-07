import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { getLanguage, t, withLanguage } from '../src/commands/i18n/index.ts';
import { messages } from '../src/commands/i18n/messages.ts';
import { refreshMessages } from '../src/commands/i18n/refresh.ts';
import { systemLanguage } from '../src/core/system-language.ts';
import type { Job, Language } from '../src/types.ts';
import { cli, home, ndjson, root, setupCliHome, writeFiles } from './cli-helpers.ts';

setupCliHome();

/** The description of `scan` in each language, as its help prints it. */
const SCAN_DESCRIPTION = {
  en: 'Update the index. Free and local',
  ja: 'インデックスを更新。無料・ローカル処理',
  'zh-CN': '更新索引，免费且在本地运行',
};

/** A file name that is also an English message, so a translation of it would show. */
const MESSAGE_LIKE_NAME = 'Nothing was sent..txt';

/** The sorted `{field}` names in a message. */
const fields = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).toSorted((a, b) => a.localeCompare(b));

/** Translates after an await, in `language`, so concurrent calls overlap. */
const translateLater = (language: Language, translate: () => string) =>
  withLanguage(language, async () => {
    await Promise.resolve();
    return translate();
  });

/** Saves `language`, and puts a file with a message-like name in the library. */
async function libraryIn(language: string) {
  await cli(['config', 'set', 'language', language]);
  await writeFiles({ [MESSAGE_LIKE_NAME]: 'sample' });
}

describe('help languages', () => {
  test('system follows the native PC language on the next invocation', async () => {
    const expected = SCAN_DESCRIPTION[await systemLanguage()];
    expect((await cli(['config', 'set', 'language', 'system'])).code).toBe(0);
    expect((await cli(['scan', '--help'])).stdout).toContain(expected);
    expect((await cli(['config', 'get', 'language'])).stdout).toBe('"system"\n');
    await cli(['config', 'set', 'language', 'en']);
    expect((await cli(['scan', '--help'])).stdout).toContain(SCAN_DESCRIPTION.en);
  });

  test.each([
    ['en', 'Usage:', 'Options:'],
    ['ja', '使い方:', 'オプション:'],
    ['zh-CN', '用法：', '选项：'],
  ] as const)(
    'saved %s controls nested help and keeps commands stable',
    async (language, usage, options) => {
      expect((await cli(['config', 'set', 'language', language])).code).toBe(0);
      expect((await cli(['config', 'get', 'language'])).stdout).toBe(`"${language}"\n`);
      const help = await cli(['scan', '--help']);
      expect(help.code).toBe(0);
      for (const text of [SCAN_DESCRIPTION[language], usage, options]) {
        expect(help.stdout).toContain(text);
      }
      expect(help.stdout).toContain('jevonganize scan [options] [path]');
      expect(help.stdout).toContain('--json');
    },
  );

  test('bad config leaves help available in English without pretending the config is valid', async () => {
    await writeFile(join(home(), 'config', 'config.toml'), 'language = "invalid"\n');
    expect((await cli(['scan', '--help'])).stdout).toContain(SCAN_DESCRIPTION.en);
    expect((await cli(['scan'])).code).toBe(2);
  });
});

describe.each([
  ['ja', 'をスキャン', '何も送信していません。', '同時に指定できません'],
  ['zh-CN', '已扫描', '未发送任何内容。', '不能同时使用'],
])('in %s', (language, scanned, nothingSent, incompatible) => {
  test('results are localized', async () => {
    await libraryIn(language);
    const scan = await cli(['scan', root]);
    expect(scan.code).toBe(0);
    expect(scan.stdout).toContain(scanned);
    expect((await cli(['organize', root, '--dry-run'])).stdout).toContain(nothingSent);
  });

  test('command errors are localized', async () => {
    await libraryIn(language);
    await cli(['scan', root]);
    const invalid = await cli(['organize', root, '--dry-run', '--apply']);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain(incompatible);
  });

  test('JSON and file names are kept as they are', async () => {
    await libraryIn(language);
    await cli(['scan', root]);
    const search = JSON.parse((await cli(['search', '--json'])).stdout) as {
      files: { name: string; status: string }[];
      total: number;
    };
    expect(search).toMatchObject({ total: 1, files: [{ name: MESSAGE_LIKE_NAME, status: 'new' }] });
    expect((await cli(['search'])).stdout).toContain(MESSAGE_LIKE_NAME);
    const jobs = ndjson<Job>((await cli(['scan', '--json'])).stdout);
    expect(jobs.at(-1)).toMatchObject({ kind: 'scan', status: 'done' });
  });
});

describe('translations', () => {
  test('each translation is non-empty and keeps every named interpolation field', () => {
    for (const [key, translations] of Object.entries({ ...messages, ...refreshMessages })) {
      for (const translation of translations) {
        expect(translation.trim()).not.toBe('');
        expect(fields(translation)).toEqual(fields(key));
      }
    }
  });

  test('concurrent invocations keep their language, and interpolation never translates user data', async () => {
    const result = await Promise.all([
      translateLater('ja', () => t('File {id}: {reason}', { id: 1, reason: 'Nothing was sent.' })),
      translateLater('zh-CN', () => t('Cancelled.')),
    ]);
    expect(result).toEqual(['ファイル 1: Nothing was sent.', '已取消。']);
    expect(getLanguage()).toBe('en');
  });
});
