import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import {
  configJsonSchema,
  configSchema,
  loadConfig,
  paths,
  saveConfig,
  UserError,
} from '../src/core/config.ts';
import { useTempHome } from './helpers.ts';

useTempHome();

describe('interface language config', () => {
  test('old and missing config follow the PC language', async () => {
    expect((await loadConfig()).language).toBe('system');
    expect(configSchema.parse({ port: 48620 }).language).toBe('system');
  });

  test.each(['system', 'en', 'ja', 'zh-CN'])(
    'persists %s without changing other settings',
    async (language) => {
      await saveConfig({ concurrency: 4, language });
      expect(await loadConfig()).toMatchObject({ language, concurrency: 4 });
      const text = await readFile(paths.configFile(), 'utf8');
      expect(text).toContain(`language = "${language}"`);
      await expect(saveConfig({ language: 'fr' })).rejects.toThrow(UserError);
      expect(await readFile(paths.configFile(), 'utf8')).toBe(text);
    },
  );

  test('the settings schema lists only supported language settings', () => {
    expect(configJsonSchema()).toHaveProperty('properties.language.enum', [
      'system',
      'en',
      'ja',
      'zh-CN',
    ]);
  });
});
