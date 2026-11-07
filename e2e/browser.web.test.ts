import { expect, type Page, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callTool, signInEnglish, startServer, type TestServer } from './server.ts';
import { startStubProvider, waitForJobs } from './stub-provider.ts';

let server: TestServer;
let authUrl: string;

test.beforeAll(async () => {
  server = await startServer();
  authUrl = server.authUrl;
});

test.afterAll(() => server.stop());

/** The tests share one server, and an earlier one may have saved another language. */
const inEnglish = (page: Page) => signInEnglish(page, authUrl);

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
  await page.getByRole('button', { name: 'Not now' }).click();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder(/Search, or/)).toBeFocused();
  await page.keyboard.press('Escape');

  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/screen=settings/);

  // Organize is a drawer on Tags now, opened from the screen's heading.
  const rail = page.getByRole('navigation', { name: 'Screens' });
  await rail.getByRole('button', { name: 'Tags', exact: true }).click();
  await expect(page).toHaveURL(/screen=tags/);
  await page.getByRole('button', { name: 'Run organize' }).click();
  await expect(page).toHaveURL(/section=organize/);
  const drawer = page.getByRole('dialog', { name: 'Organize' });
  await expect(drawer.getByRole('button', { name: /Organize \d* ?files/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/section=organize/);

  // Organize warms the config cache, and Settings must still fill its form from it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Server and speed' }).click();
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

test('the rail has six screens, and an old Review link opens the Review section of Tags', async ({
  page,
}) => {
  await inEnglish(page);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();

  const rail = page.getByRole('navigation', { name: 'Screens' });
  await expect(rail.getByRole('button')).toHaveCount(6);
  for (const name of ['Files', 'Folders', 'Tags', 'Dashboard', 'Questions', 'Settings'])
    await expect(rail.getByRole('button', { name, exact: true })).toBeVisible();

  await page.goto(new URL('/?screen=review', authUrl).href);
  await expect(page).toHaveURL(/screen=tags&section=review/);
  await expect(rail.getByRole('button', { name: 'Tags', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const sections = page.getByRole('navigation', { name: 'Tag sections' });
  await expect(sections.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText(/Review · \d+ pending/)).toBeVisible();

  // The old key still goes where Activity went.
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page).toHaveURL(/screen=dashboard&section=history/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
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
    await page.getByRole('button', { name: 'Not now' }).click();
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

/** The tour after setup: every step, skipping targets that are not on the page, then a restart. */
test('the guided tour follows setup once and can be started again', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await inEnglish(page);
    await page.getByRole('button', { name: 'Skip for now' }).click();
    const tour = page.getByRole('dialog');
    await expect(tour).toHaveAccessibleName('Welcome to Jevonganize');
    await expect(page.getByRole('button', { name: 'Show me around' })).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(tour).toHaveAccessibleName('Your folders');
    await expect(page.getByTestId('tour-highlight')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(tour).toHaveAccessibleName('Favorites');
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(tour).toHaveAccessibleName('Your folders');

    // Down the rail, each screen in turn. Every target is on the page, even with no library.
    const steps = ['Favorites', 'Scan', 'Organize', 'Folders', 'Tags', 'Review', "A tag's actions"];
    for (const name of [...steps, 'Dashboard', 'Questions', 'Settings']) {
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(tour).toHaveAccessibleName(name, { timeout: 5000 });
    }
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(tour).toBeHidden();

    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Tabs' })).toBeVisible();
    await expect(tour).toBeHidden();

    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('Start the tour');
    await page.keyboard.press('Enter');
    await expect(tour).toHaveAccessibleName('Welcome to Jevonganize');
    await page.keyboard.press('Escape');
    await expect(tour).toBeHidden();
  } finally {
    await context.close();
  }
});

test('the AI models page explains each model and checks provider fields', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await inEnglish(page);
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'AI models' }).click();

    const decision = page.getByRole('region', { name: 'Decision model' });
    await expect(decision).toContainText('Decides every tag');
    await expect(decision.getByRole('textbox')).toHaveAttribute('placeholder', 'gpt-6-luna');
    await expect(decision.getByText('Server address')).toBeHidden();
    await expect(page.getByRole('region', { name: 'Name-reading model' })).toBeVisible();

    const chat = page.getByRole('region', { name: 'Chat model' });
    await chat.getByRole('radio', { name: 'A different model' }).click();
    await chat.getByRole('combobox', { name: 'AI service' }).click();
    await page.getByRole('option', { name: 'OpenAI-compatible chat server' }).click();
    await expect(chat.getByText('Server address')).toBeVisible();
    await expect(chat.getByText('Required for this provider.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Discard' }).click();

    // The search narrows the nav to pages that hold a match.
    await page.getByRole('searchbox', { name: 'Search settings' }).fill('thumbnail');
    await expect(page.getByRole('button', { name: 'File list' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI models' })).toBeHidden();
  } finally {
    await context.close();
  }
});

/** The file of that name in the index, with its tags. */
async function fileNamed(page: Page, name: string) {
  const found = (await callTool(page, 'search_files', { limit: 50 })) as {
    files: { id: number; name: string; tags: string[] }[];
  };
  return found.files.find((file) => file.name === name);
}

test('a starred tag shows in Favorites, filters the list, and tags files dropped on it', async ({
  page,
}) => {
  const library = await mkdtemp(join(tmpdir(), 'jevonganize-e2e-lib-'));
  await writeFile(join(library, 'ledger.txt'), 'quarterly ledger');
  await writeFile(join(library, 'receipt.txt'), 'taxi receipt');
  await inEnglish(page);
  await callTool(page, 'add_library', { path: library });
  await callTool(page, 'scan', { path: library });
  await expect.poll(async () => (await fileNamed(page, 'receipt.txt'))?.tags).toEqual([]);
  const ledger = await fileNamed(page, 'ledger.txt');
  const seed = (await callTool(page, 'propose_changes', {
    file_ids: [ledger!.id],
    add: ['topic:books'],
    title: 'seed',
  })) as { id: string };
  await callTool(page, 'apply_plan', { id: seed.id });
  await expect
    .poll(async () => (await fileNamed(page, 'ledger.txt'))?.tags)
    .toEqual(['topic:books']);

  // A library exists now, so the shell opens with no onboarding and no tour.
  await page.reload();
  const favorites = page.locator('[data-tour="favorites"]');
  await expect(favorites).toContainText('Press ☆ on a tag to pin it here');
  await page.getByRole('gridcell').filter({ hasText: 'ledger.txt' }).click();
  const star = page.getByRole('button', { name: 'Favorite topic:books' });
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  const row = favorites.getByRole('button', { name: /^topic:books/ });
  await row.click();
  await expect(page).toHaveURL(/tag=topic(:|%3A)books/);
  await expect(page.getByRole('gridcell').filter({ hasText: 'receipt.txt' })).toBeHidden();

  // Back to every file, then drop the untagged one on the favorite.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('gridcell').filter({ hasText: 'receipt.txt' }).dragTo(row);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Add topic:books to 1 files');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(async () => (await fileNamed(page, 'receipt.txt'))?.tags)
    .toEqual(['topic:books']);
  await rm(library, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('the Dashboard shows the cards, the daily chart and the history after an organize run', async ({
  page,
}) => {
  // Usage rows come from the app's own flow: a real organize run against a stub provider.
  const stub = await startStubProvider();
  const folder = await mkdtemp(join(tmpdir(), 'jevonganize-e2e-library-'));
  let library: { path: string } | undefined;
  try {
    await writeFile(join(folder, 'invoice.txt'), 'invoice total amount due from acme');
    await writeFile(join(folder, 'notes.txt'), 'meeting notes about the budget');
    await page.goto(authUrl);
    const provider = { name: 'openrouter', model: 'jev', base_url: stub.url };
    await callTool(page, 'set_config', { language: 'en', provider });
    await callTool(page, 'set_api_key', { provider: 'openrouter', key: 'test-key' });
    library = await callTool<{ path: string }>(page, 'add_library', { path: folder });
    await callTool(page, 'scan', { path: library.path });
    await waitForJobs(page);
    await callTool(page, 'organize', { query: {} });
    await waitForJobs(page);

    await page.goto(new URL('/?screen=dashboard', authUrl).href);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('[data-card]')).toHaveCount(4);
    // The stub's run costs a fraction of a cent, which shows as "< $0.01" rather than "≈ $0.00".
    await expect(page.getByText(/^< \$0\.01$/).first()).toBeVisible();
    await expect(page.locator('svg g[data-day] rect').first()).toBeAttached();
    await expect(page.getByRole('table', { name: 'By feature' })).toContainText('Organize');
    await expect(page.getByRole('table', { name: 'Libraries' })).toBeVisible();

    // The history, once Activity, sits beside the overview and lists the run.
    await expect(page.getByText('History', { exact: true })).toBeVisible();
    await expect(page.getByText('Organizing').first()).toBeVisible();
    await page.getByRole('combobox', { name: 'Show' }).click();
    await page.getByRole('option', { name: 'Applied' }).click();
    await expect(page).toHaveURL(/plans=applied/);
  } finally {
    // Later tests start from an empty index, which shows onboarding.
    if (library) await callTool(page, 'remove_library', { path: library.path });
    await stub.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
