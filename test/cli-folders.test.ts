import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import type { VfolderSuggestion, VfolderTagSuggestions } from '../src/tool-map.ts';
import type { Plan, VirtualFolder, VirtualFolderTree } from '../src/types.ts';
import { cli, root, setupCliHome } from './cli-helpers.ts';

setupCliHome();

/**
 * A library of a tagged `tax.pdf` and an untagged `new.pdf`, with the folder `Taxes` on
 * `topic:finance/tax` and its child `2025` on `year:2025`. Returns the two runs that added them.
 */
async function taxesLibrary() {
  await writeFile(join(root, 'tax.pdf'), 'tax');
  await writeTags(join(root, 'tax.pdf'), ['topic:finance/tax']);
  await writeFile(join(root, 'new.pdf'), 'new');
  expect((await cli(['scan', root])).code).toBe(0);
  const parent = await cli(['folders', 'add', 'Taxes', '--tag', 'topic:finance/tax']);
  const childArgs = ['add', '2025', '--parent', 'Taxes', '--tag', 'year:2025', '--json'];
  const child = await cli(['folders', ...childArgs]);
  return { parent, child };
}

test('folders add names the home tag, and --json returns the folder', async () => {
  const { parent, child } = await taxesLibrary();
  expect(parent).toMatchObject({ code: 0 });
  expect(parent.stdout).toContain('Files put in it get topic:finance/tax.');
  expect(JSON.parse(child.stdout)).toMatchObject({
    name: '2025',
    tag: 'year:2025',
  } satisfies Partial<VirtualFolder>);
});

test('folders lists a child under its parent a child under its parent, with counts and home tags', async () => {
  await taxesLibrary();
  const listed = await cli(['folders']);
  expect(listed.stdout).toMatch(/^Taxes {2}1 {2}topic:finance\/tax/m);
  expect(listed.stdout).toMatch(/^ {2}2025 {2}0 /m);
});

test('folders show takes a saved name or a generated key, and an unknown one is exit 2', async () => {
  await taxesLibrary();
  expect((await cli(['folders', 'show', 'Taxes'])).stdout).toContain('1 of 1 files');
  expect((await cli(['folders', 'show', 'topic:finance'])).stdout).toContain('tax.pdf');
  expect((await cli(['folders', 'show', 'Nope'])).code).toBe(2);
});

test('folders put stores a plan of every home tag on the path, and apply writes them', async () => {
  await taxesLibrary();
  const newPdf = join(root, 'new.pdf');
  const put = await cli(['folders', 'put', 'Taxes/2025', newPdf, '--json']);
  const plan = JSON.parse(put.stdout) as Plan;
  expect(plan.summary.added).toEqual({ 'topic:finance/tax': 1, 'year:2025': 1 });
  expect(await readTags(newPdf)).toEqual([]);
  expect((await cli(['apply', plan.id])).code).toBe(0);
  expect(await readTags(newPdf)).toEqual(['topic:finance/tax', 'year:2025']);
  expect((await cli(['folders', 'show', '2025'])).stdout).toContain('new.pdf');
});

test('folders rm deletes the folder and changes no file or tag', async () => {
  await taxesLibrary();
  const removed = await cli(['folders', 'rm', 'Taxes']);
  expect(removed.stdout).toContain('No file or tag changed.');
  const tree = JSON.parse((await cli(['folders', '--json'])).stdout) as VirtualFolderTree;
  expect(tree.saved).toEqual([]);
  expect(await readTags(join(root, 'tax.pdf'))).toEqual(['topic:finance/tax']);
});

test('folders: a hostile tag is safe in text output, and kept in --json', async () => {
  await writeFile(join(root, 'a.txt'), 'a');
  await cli(['scan', root]);
  const hostile = 'x:\x1b]0;pwned\x07';
  // A foreign tag can hold what Jevonganize would never write, so plant it in the mirror.
  const db = openDb();
  db.addFileTags(db.fileByPath(join(root, 'a.txt'))!.id, [hostile], false);
  db.close();
  const text = await cli(['folders', '--auto']);
  expect(text.stdout).not.toContain('\x1b');
  expect(text.stdout).toContain('?]0;pwned?');
  const json = await cli(['folders', '--auto', '--json']);
  const tree = JSON.parse(json.stdout) as VirtualFolderTree;
  expect(tree.generated[0]?.children[0]?.key).toBe(hostile);
});

/** Two scanned files that both carry a hostile foreign tag and `topic:finance`. */
async function hostileLibrary(hostile: string) {
  await writeFile(join(root, 'a.txt'), 'a');
  await writeFile(join(root, 'b.txt'), 'b');
  await cli(['scan', root]);
  const db = openDb();
  for (const name of ['a.txt', 'b.txt']) {
    db.addFileTags(db.fileByPath(join(root, name))!.id, [hostile, 'topic:finance'], false);
  }
  db.close();
}

test('folders suggest: a hostile tag is safe in text output, and kept in --json', async () => {
  const hostile = 'x:\x1b]0;pwned\x07';
  await hostileLibrary(hostile);
  const text = await cli(['folders', 'suggest']);
  expect(text).toMatchObject({ code: 0 });
  expect(text.stdout).not.toContain('\x1b');
  expect(text.stdout).toContain('?]0;pwned?');
  const json = await cli(['folders', 'suggest', '--json']);
  const suggestions = JSON.parse(json.stdout) as VfolderSuggestion[];
  expect(suggestions.flatMap((suggestion) => suggestion.rule.tags)).toContain(hostile);
});

test('folders suggest --tags: tags for a rule, safe in text and raw in --json', async () => {
  const hostile = 'x:\x1b]0;pwned\x07';
  await hostileLibrary(hostile);
  const text = await cli(['folders', 'suggest', '--tags']);
  expect(text.stdout).toContain('2 files match this rule.');
  expect(text.stdout).not.toContain('\x1b');
  expect(text.stdout).toMatch(/^x:\?\]0;pwned\? {2}2\/2 {2}common$/m);
  const json = await cli(['folders', 'suggest', '--tags', '--json']);
  const result = JSON.parse(json.stdout) as VfolderTagSuggestions;
  expect(result.suggestions.map((suggestion) => suggestion.tag)).toContain(hostile);
  const narrowed = await cli(['folders', 'suggest', '--tag', 'topic:finance', '--json']);
  // The hostile tag is on both files the rule matches, so it narrows nothing.
  expect(JSON.parse(narrowed.stdout)).toEqual({ matches: 2, suggestions: [] });
});
