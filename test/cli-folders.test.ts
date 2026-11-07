import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import type { Plan, VirtualFolder, VirtualFolderTree } from '../src/types.ts';
import { cli, root, setupCliHome } from './cli-helpers.ts';

setupCliHome();

describe('jevonganize folders', () => {
  test('add, list, show, put, apply and rm', async () => {
    await writeFile(join(root, 'tax.pdf'), 'tax');
    await writeTags(join(root, 'tax.pdf'), ['topic:finance/tax']);
    await writeFile(join(root, 'new.pdf'), 'new');
    expect((await cli(['scan', root])).code).toBe(0);

    const added = await cli(['folders', 'add', 'Taxes', '--tag', 'topic:finance/tax']);
    expect(added).toMatchObject({ code: 0 });
    expect(added.stdout).toContain('Files put in it get topic:finance/tax.');
    const child = await cli([
      'folders',
      'add',
      '2025',
      '--parent',
      'Taxes',
      '--tag',
      'year:2025',
      '--json',
    ]);
    expect(JSON.parse(child.stdout)).toMatchObject({
      name: '2025',
      tag: 'year:2025',
    } satisfies Partial<VirtualFolder>);

    const listed = await cli(['folders']);
    expect(listed.stdout).toMatch(/^Taxes {2}1 {2}topic:finance\/tax/m);
    expect(listed.stdout).toMatch(/^ {2}2025 {2}0 /m);

    expect((await cli(['folders', 'show', 'Taxes'])).stdout).toContain('1 of 1 files');
    expect((await cli(['folders', 'show', 'topic:finance'])).stdout).toContain('tax.pdf');
    expect((await cli(['folders', 'show', 'Nope'])).code).toBe(2);

    const put = await cli(['folders', 'put', 'Taxes/2025', join(root, 'new.pdf'), '--json']);
    const plan = JSON.parse(put.stdout) as Plan;
    expect(plan.summary.added).toEqual({ 'topic:finance/tax': 1, 'year:2025': 1 });
    expect(await readTags(join(root, 'new.pdf'))).toEqual([]);
    expect((await cli(['apply', plan.id])).code).toBe(0);
    expect(await readTags(join(root, 'new.pdf'))).toEqual(['topic:finance/tax', 'year:2025']);
    expect((await cli(['folders', 'show', '2025'])).stdout).toContain('new.pdf');

    const removed = await cli(['folders', 'rm', 'Taxes']);
    expect(removed.stdout).toContain('No file or tag changed.');
    const tree = JSON.parse((await cli(['folders', '--json'])).stdout) as VirtualFolderTree;
    expect(tree.saved).toEqual([]);
    expect(await readTags(join(root, 'tax.pdf'))).toEqual(['topic:finance/tax']);
  });

  test('a hostile tag is safe in text output, and kept in --json', async () => {
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
    const json = JSON.parse(
      (await cli(['folders', '--auto', '--json'])).stdout,
    ) as VirtualFolderTree;
    expect(json.generated[0]?.children[0]?.key).toBe(hostile);
  });
});
