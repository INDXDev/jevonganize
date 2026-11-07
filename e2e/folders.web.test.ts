/** The Folders screen against the real server, on a small library tagged before any folder exists. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { signInEnglish, startServer, type TestServer } from './server.ts';

/** Each test builds on the folders the one before made. */
test.describe.configure({ mode: 'serial' });

/** The library's files, by name, with the tags each one gets. */
const LIBRARY_TAGS: Record<string, string[]> = {
  'a.txt': ['topic:finance', 'year:2024'],
  'b.txt': ['topic:finance', 'year:2024'],
  'c.txt': ['topic:finance', 'year:2023'],
  'd.txt': ['topic:finance'],
  'e.txt': ['party:acme', 'year:2024'],
  'f.txt': ['party:acme'],
};

let server: TestServer;
let library: string;

/**
 * Runs in the page: adds `path` as a library, scans it, and tags each file through a plan, as a
 * person would. page.evaluate sends it as text, so its helpers live inside it.
 */
async function seedInPage({ path, tagsByName }: { path: string; tagsByName: typeof LIBRARY_TAGS }) {
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const call = async (tool: string, input: unknown) => {
    const response = await fetch(`/api/call/${tool}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const envelope = await response.json();
    if (!envelope.ok) throw new Error(envelope.error);
    return envelope.data;
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const until = async (done: () => Promise<boolean>) => {
    for (let i = 0; i < 200 && !(await done()); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
  };
  await call('add_library', { path });
  await call('scan', { path });
  let files: { id: number; name: string }[] = [];
  await until(async () => {
    files = (await call('search_files', {})).files;
    return files.length === Object.keys(tagsByName).length;
  });
  for (const file of files) {
    const add = tagsByName[file.name];
    const plan = await call('propose_changes', { file_ids: [file.id], add, title: 'seed' });
    await call('apply_plan', { id: plan.id });
    await until(async () => (await call('get_plan', { id: plan.id })).status === 'applied');
  }
}

test.beforeAll(async ({ browser }) => {
  server = await startServer();
  library = await mkdtemp(join(tmpdir(), 'jevonganize-e2e-library-'));
  for (const name of Object.keys(LIBRARY_TAGS)) await writeFile(join(library, name), name);
  const page = await browser.newPage();
  await page.goto(server.authUrl);
  await page.evaluate(seedInPage, { path: library, tagsByName: LIBRARY_TAGS });
  await page.close();
});

test.afterAll(async () => {
  await server.stop();
  await rm(library, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Opens Folders. With a library already there, neither onboarding nor the tour shows. */
async function openFolders(page: Page) {
  await signInEnglish(page, server.authUrl);
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('button', { name: 'Folders', exact: true })
    .click();
  await expect(page).toHaveURL(/screen=folders/);
}

const treeOf = (page: Page) => page.locator('[data-tour="vfolders"]');
const filesOf = (page: Page) => page.getByRole('grid', { name: 'Files' }).getByRole('gridcell');

test('a suggested folder is made with one click and lists its files', async ({ page }) => {
  await openFolders(page);
  await expect(page.getByRole('heading', { name: 'No folders yet' })).toBeVisible();
  await treeOf(page).getByRole('button', { name: 'Create the folder finance' }).click();
  await expect(page).toHaveURL(/vfolder=\d+/);
  await expect(filesOf(page)).toHaveCount(4);
  await expect(treeOf(page).getByRole('button', { name: /^finance/ })).toBeVisible();
});

test('taking a tag out of the rule saves it and changes the count', async ({ page }) => {
  await openFolders(page);
  await treeOf(page)
    .getByRole('button', { name: /^finance/ })
    .click();
  const list = page.getByTestId('list');
  await expect(list.getByText('4 files', { exact: true })).toBeVisible();
  await list.getByRole('button', { name: 'Remove topic:finance' }).click();
  await expect(list.getByText('6 files', { exact: true })).toBeVisible();
  await expect(filesOf(page)).toHaveCount(6);
});

test('the New folder dialog offers tags as you type and narrows with a suggestion', async ({
  page,
}) => {
  await openFolders(page);
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const tags = dialog.getByRole('combobox', { name: 'Tags' });
  await tags.pressSequentially('f');
  await expect(dialog.getByRole('option', { name: /^topic:finance/ })).toBeVisible();
  await tags.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Remove topic:finance' })).toBeVisible();
  await expect(dialog.getByText('4 files match')).toBeVisible();
  const suggested = dialog.getByRole('group', { name: 'Suggested tags' });
  await suggested.getByRole('button', { name: /^year:2024/ }).click();
  await expect(dialog.getByText('2 files match')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Finance 2024');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(treeOf(page).getByRole('button', { name: /^Finance 2024/ })).toBeVisible();
  await expect(filesOf(page)).toHaveCount(2);
});

test('a folder can be made with clicks alone', async ({ page }) => {
  await openFolders(page);
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const suggested = dialog.getByRole('group', { name: 'Suggested tags' });
  await suggested.getByRole('button', { name: /^party:acme/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('acme');
  await expect(dialog.getByText('2 files match')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(treeOf(page).getByRole('button', { name: /^acme/ })).toBeVisible();
});
