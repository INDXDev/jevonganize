/** The Tags screen against the real server, on a small library tagged for real. */
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { callTool, signInEnglish, startServer, type TestServer } from './server.ts';

let server: TestServer;
let dir: string;

/** Runs a tool that starts a job, and waits for the job to end. */
async function runJob(page: Page, tool: string, input: object) {
  const job = await callTool<{ id: string }>(page, tool, input);
  await expect
    .poll(async () => {
      const status = await callTool<{ jobs: { id: string; status: string }[] }>(page, 'status', {});
      return status.jobs.find((entry) => entry.id === job.id)?.status;
    })
    .toBe('done');
}

type SeedFile = { id: number; name: string; tags: string[] };

/** The library's files by name. */
async function filesByName(page: Page, folder: string) {
  const { files } = await callTool<{ files: SeedFile[] }>(page, 'search_files', { folder });
  return Object.fromEntries(files.map((file) => [file.name, file]));
}

/**
 * A library whose files carry topic tags, written for real: tax, finance, and law on two files. One
 * of those is then saved over, which loses its tag, so the next scan raises a restore review item.
 */
async function seedTagLibrary(page: Page) {
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) await writeFile(join(dir, name), name);
  // The index keeps the canonical path: /private/var on macOS, the long name on Windows.
  ({ path: dir } = await callTool<{ path: string }>(page, 'add_library', { path: dir }));
  await runJob(page, 'scan', { path: dir });
  const files = await filesByName(page, dir);
  const seeds: [string[], string][] = [
    [['a.txt'], 'topic:tax'],
    [['b.txt'], 'topic:finance'],
    [['c.txt', 'd.txt'], 'topic:law'],
  ];
  for (const [names, tag] of seeds) {
    const fileIds = names.map((name) => files[name]!.id);
    const plan = await callTool<{ id: string }>(page, 'propose_changes', {
      file_ids: fileIds,
      add: [tag],
      title: `seed ${tag}`,
    });
    await runJob(page, 'apply_plan', { id: plan.id });
  }
  // A save that writes a new file and renames it over the old one drops its tags, as many apps
  // do. The rename, unlike unlink and create, never reuses the old inode, so the scan sees a
  // replaced file on every OS.
  await writeFile(join(dir, 'c.txt.new'), 'c.txt, saved again with more text');
  await rename(join(dir, 'c.txt.new'), join(dir, 'c.txt'));
  await runJob(page, 'scan', { path: dir });
}

test.beforeAll(async ({ browser }) => {
  server = await startServer();
  dir = await mkdtemp(join(tmpdir(), 'jevonganize-e2e-tags-'));
  const page = await browser.newPage();
  await page.goto(server.authUrl);
  await seedTagLibrary(page);
  await page.close();
});

test.afterAll(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Opens Tags. With a library already there, neither onboarding nor the tour shows. */
async function openTags(page: Page) {
  await signInEnglish(page, server.authUrl);
  await page.goto(new URL('/?screen=tags', server.authUrl).href);
  return page.getByRole('tree', { name: 'Tags' });
}

test('a review item is approved from Tags as a plan block, then applied', async ({ page }) => {
  await signInEnglish(page, server.authUrl);
  const rail = page.getByRole('navigation', { name: 'Screens' });
  await rail.getByRole('button', { name: /^Tags/ }).click();
  const sections = page.getByRole('navigation', { name: 'Tag sections' });
  await sections.getByRole('button', { name: /^Review/ }).click();
  await expect(page).toHaveURL(/section=review/);
  await expect(page.getByText('Review · 1 pending')).toBeVisible();
  await expect(page.getByText('restore: topic:law')).toBeVisible();

  await sections.getByRole('button', { name: 'All tags' }).click();
  const tree = page.getByRole('tree', { name: 'Tags' });
  await tree.getByRole('button', { name: 'law', exact: true }).click();
  await expect(page).toHaveURL(/tag=topic%3Alaw/);
  await expect(page.getByText('To review 1')).toBeVisible();
  await page.getByRole('button', { name: 'Accept c.txt' }).click();
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect
    .poll(async () => (await filesByName(page, dir))['c.txt']?.tags)
    .toContain('topic:law');
});

test('a tag starred in the tree shows in the Favorites of the Files sidebar', async ({ page }) => {
  const tree = await openTags(page);
  const star = tree.getByRole('button', { name: 'Favorite topic:law' });
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  const rail = page.getByRole('navigation', { name: 'Screens' });
  await rail.getByRole('button', { name: 'Files', exact: true }).click();
  const favorites = page.locator('[data-tour="favorites"]');
  await expect(favorites.getByRole('button', { name: /^topic:law/ })).toBeVisible();
});

test('dragging topic:tax onto topic:finance moves it under finance once applied', async ({
  page,
}) => {
  const tree = await openTags(page);
  const row = (label: string) =>
    tree
      .getByRole('treeitem')
      .filter({ has: page.getByRole('button', { name: label, exact: true }) });
  await expect(row('tax')).toHaveAttribute('aria-level', '2');

  await row('tax').dragTo(row('finance'));
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  // finance › tax: tax now sits one level below finance.
  await expect(row('tax')).toHaveAttribute('aria-level', '3');
  await row('tax').getByRole('button', { name: 'tax', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Tag path' })).toHaveText(/topic›finance›tax/);
  await expect
    .poll(async () => (await filesByName(page, dir))['a.txt']?.tags)
    .toContain('topic:finance/tax');
});
