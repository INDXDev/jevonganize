import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

let server: ChildProcess;
let home: string;
let authUrl: string;

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'jevonganize-e2e-'));
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
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder(/Search, or/)).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/screen=settings/);

  expect(errors).toEqual([]);
});
