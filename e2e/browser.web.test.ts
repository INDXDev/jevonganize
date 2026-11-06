import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

let server: ChildProcess;
let home: string;
let authUrl: string;

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'jevonganize-e2e-'));
  await mkdir(join(home, 'config'));
  await writeFile(join(home, 'config', 'config.toml'), 'language = "en"\n');
  server = spawn('node', ['dist/cli.mjs', '--port', '4173', '--no-open'], {
    env: { ...process.env, JEVONGANIZE_HOME: home },
  });
  // The token is made at launch, so the printed URL is the only way in.
  authUrl = await new Promise((resolve, reject) => {
    server.stdout?.on('data', (data: Buffer) => {
      const found = /http:\S+/.exec(String(data));
      if (found) resolve(found[0]);
    });
    server.once('exit', () => reject(new Error('server exited')));
  });
});

test.afterAll(async () => {
  server.kill();
  await rm(home, { recursive: true, force: true });
});

/** Smoke test against the real server: the shell loads, and the palette and views respond. */
test('the app loads and its main paths work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(authUrl);

  // A fresh index shows onboarding. Skipping it must reach the browser.
  const skip = page.getByRole('button', { name: 'Skip for now' });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder(/Search, or/)).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/screen=settings/);

  await page.getByRole('button', { name: 'Organize', exact: true }).first().click();
  await expect(page).toHaveURL(/screen=organize/);
  await expect(page.getByRole('button', { name: /Organize \d* ?files/ })).toBeDisabled();

  // Organize warms the config cache, and Settings must still fill its form from it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('spinbutton').first()).not.toHaveValue('');

  // The theme starts on the system's, and the button pins light and then dark.
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = page.getByRole('button', { name: /^Theme:/ });
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await background();
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await background();
  expect(light).not.toBe(dark);
  await theme.click();
  await theme.click();
  expect(await background()).toBe(dark);

  expect(errors).toEqual([]);
});

test('saved languages update the UI, survive reload, and follow this PC independently of browser language', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await context.newPage();
  try {
    await page.goto(authUrl);
    const skip = page.getByRole('button', { name: 'Skip for now' });
    await expect(skip).toBeVisible();
    await skip.click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    for (const [language, nativeName, settings, save, notice] of [
      ['ja', '日本語', '設定', 'Save', '設定を保存しました'],
      ['zh-CN', '简体中文', '设置', '保存', '设置已保存'],
      ['en', 'English', 'Settings', '保存', 'Settings saved'],
    ]) {
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: nativeName, exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^${save}`) }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', language!);
      await expect(page.locator('output')).toHaveText(notice!);
      await expect(
        page.getByRole('button', { name: settings!, exact: true }).first(),
      ).toBeVisible();
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', language!);
      const skipReload = page.getByRole('button', { name: /Skip for now|今はスキップ|暂时跳过/ });
      if (await skipReload.isVisible()) await skipReload.click();
    }

    // The browser's German setting must not choose the local application's language.
    const config = await page.evaluate(async () => {
      const result = await fetch('/api/call/get_config', { method: 'POST', body: '{}' });
      return (await result.json()).data as { system_language: string };
    });
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'System default', exact: true }).click();
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', config.system_language);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', config.system_language);
  } finally {
    await context.close();
  }
});
