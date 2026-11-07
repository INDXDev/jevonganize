import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// Needs `pnpm build`: this boots dist/desktop/main.mjs, the package's `main`.
test('the shell boots a sandboxed window over the local server', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jevonganize-e2e-'));
  process.env.JEVONGANIZE_HOME = home;
  const app = await electron.launch({ args: ['.'] });
  try {
    const page = await app.firstWindow();
    // /auth redirects to /, which also drops the token from the address bar.
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/(\?.*)?$/);
    const { origin } = new URL(page.url());

    expect(await page.evaluate(() => typeof require)).toBe('undefined');
    expect(await page.evaluate(() => window.open('https://example.com/'))).toBeNull();

    await page.evaluate(() => {
      location.href = 'https://example.com/';
    });
    await page.waitForTimeout(500);
    expect(new URL(page.url()).origin).toBe(origin); // a restored tab may change the query
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
});
