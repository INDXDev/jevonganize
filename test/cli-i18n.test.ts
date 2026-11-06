import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { getLanguage, t, withLanguage } from '../src/commands/i18n/index.ts';
import { systemLanguage } from '../src/core/system-language.ts';
import { messages } from '../src/commands/i18n/messages.ts';
import { cli, home, ndjson, root, setupCliHome } from './cli-helpers.ts';

setupCliHome();

const fields = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).toSorted((a, b) => a.localeCompare(b));

describe('terminal languages', () => {
  test('system follows the native PC language on the next invocation', async () => {
    const expected = {
      en: 'Update the index. Free and local',
      ja: 'インデックスを更新。無料・ローカル処理',
      'zh-CN': '更新索引，免费且在本地运行',
    }[systemLanguage()];
    expect((await cli(['config', 'set', 'language', 'system'])).code).toBe(0);
    expect((await cli(['scan', '--help'])).stdout).toContain(expected);
    expect((await cli(['config', 'get', 'language'])).stdout).toBe('"system"\n');
    await cli(['config', 'set', 'language', 'en']);
    expect((await cli(['scan', '--help'])).stdout).toContain('Update the index. Free and local');
  });

  test.each([
    ['en', 'Update the index. Free and local', 'Usage:', 'Options:'],
    ['ja', 'インデックスを更新。無料・ローカル処理', '使い方:', 'オプション:'],
    ['zh-CN', '更新索引，免费且在本地运行', '用法：', '选项：'],
  ])(
    'saved %s controls nested help and keeps commands stable',
    async (language, description, usage, options) => {
      expect((await cli(['config', 'set', 'language', language])).code).toBe(0);
      expect((await cli(['config', 'get', 'language'])).stdout).toBe(`"${language}"\n`);
      const help = await cli(['scan', '--help']);
      expect(help.code).toBe(0);
      expect(help.stdout).toContain(description);
      expect(help.stdout).toContain(usage);
      expect(help.stdout).toContain(options);
      expect(help.stdout).toContain('jevonganize scan [options] [path]');
      expect(help.stdout).toContain('--json');
    },
  );

  test.each([
    ['ja', 'をスキャン', '何も送信していません。', '同時に指定できません'],
    ['zh-CN', '已扫描', '未发送任何内容。', '不能同时使用'],
  ])(
    '%s localizes results and command errors but preserves JSON and filenames',
    async (language, scanned, nothingSent, incompatible) => {
      await cli(['config', 'set', 'language', language]);
      const name = 'Nothing was sent..txt';
      await writeFile(join(root, name), 'sample');
      const scan = await cli(['scan', root]);
      expect(scan.code).toBe(0);
      expect(scan.stdout).toContain(scanned);
      expect((await cli(['organize', root, '--dry-run'])).stdout).toContain(nothingSent);
      const invalid = await cli(['organize', root, '--dry-run', '--apply']);
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain(incompatible);
      const search = await cli(['search', '--json']);
      const result = JSON.parse(search.stdout) as {
        files: { name: string; status: string }[];
        total: number;
      };
      expect(result).toMatchObject({ total: 1, files: [{ name, status: 'new' }] });
      expect((await cli(['search'])).stdout).toContain(name);
      const jobs = ndjson<{ kind: string; status: string }>((await cli(['scan', '--json'])).stdout);
      expect(jobs.at(-1)).toMatchObject({ kind: 'scan', status: 'done' });
    },
  );

  test('bad config leaves help available in English without pretending the config is valid', async () => {
    await writeFile(join(home(), 'config', 'config.toml'), 'language = "invalid"\n');
    expect((await cli(['scan', '--help'])).stdout).toContain('Update the index. Free and local');
    expect((await cli(['scan'])).code).toBe(2);
  });

  test('each translation preserves every named interpolation field', () => {
    for (const [key, translations] of Object.entries(messages)) {
      for (const translation of translations) {
        expect(translation.trim()).not.toBe('');
        expect(fields(translation)).toEqual(fields(key));
      }
    }
  });

  test('concurrent invocations keep their language, and interpolation never translates user data', async () => {
    const result = await Promise.all([
      withLanguage('ja', async () => {
        await Promise.resolve();
        return t('File {id}: {reason}', { id: 1, reason: 'Nothing was sent.' });
      }),
      withLanguage('zh-CN', async () => {
        await Promise.resolve();
        return t('Cancelled.');
      }),
    ]);
    expect(result).toEqual(['ファイル 1: Nothing was sent.', '已取消。']);
    expect(getLanguage()).toBe('en');
  });
});
