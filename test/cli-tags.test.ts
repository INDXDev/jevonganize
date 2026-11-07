import { rm } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import type { Plan, TagNode } from '../src/types.ts';
import {
  cli,
  lines,
  printedPlanId,
  root,
  scanFiles,
  setupCliHome,
  writeFiles,
} from './cli-helpers.ts';

setupCliHome();

describe('tags add, as a plan', () => {
  test('stores a plan and writes nothing until apply', async () => {
    const paths = await scanFiles({ 'a.txt': 'hello' });
    const added = await cli(['tags', 'add', root, 'project:acme']);
    expect(added.stdout).toContain('1 files, 1 tags added, 0 removed');
    expect(added.stdout).toContain('Nothing was written.');
    expect(await readTags(paths['a.txt']!)).toEqual([]);
    const listed = await cli(['plans', '--status', 'proposed']);
    expect(listed.stdout).toContain(printedPlanId(added.stdout));
  });

  test('apply writes the tags, undo reverses them, and an undone plan cannot be applied', async () => {
    const path = (await scanFiles({ 'a.txt': 'hello' }))['a.txt']!;
    const id = printedPlanId((await cli(['tags', 'add', root, 'project:acme'])).stdout);
    expect((await cli(['apply', id])).stdout).toContain(`Undo: jevonganize undo ${id}`);
    expect(await readTags(path)).toEqual(['project:acme']);
    expect((await cli(['undo', id])).stdout).toContain(`Undid ${id}: 1 files.`);
    expect(await readTags(path)).toEqual([]);
    expect((await cli(['apply', id])).code).toBe(2);
  });

  test('apply exits 1 when an op fails, and the others stay applied', async () => {
    const paths = await scanFiles({ 'a.txt': 'a', 'b.txt': 'b' });
    const { stdout } = await cli(['tags', 'add', root, 'x']);
    await rm(paths['a.txt']!);
    const result = await cli(['apply', printedPlanId(stdout)]);
    expect(result.code).toBe(1);
    expect(await readTags(paths['b.txt']!)).toEqual(['x']);
  });

  test('an invalid tag is refused with exit 2', async () => {
    await cli(['scan', root]);
    const { code, stderr } = await cli(['tags', 'add', root, 'a,b']);
    expect(code).toBe(2);
    expect(stderr).toContain('cannot contain');
  });
});

test('--apply goes at once, on a single file too, and rename and remove follow', async () => {
  const path = (await scanFiles({ 'a.txt': 'hello' }))['a.txt']!;
  await cli(['tags', 'add', path, 'one', 'two', '--apply']);
  expect(await readTags(path)).toEqual(['one', 'two']);
  await cli(['tags', 'rename', 'one', 'uno', '--apply']);
  await cli(['tags', 'remove', root, 'two', '--apply']);
  expect(await readTags(path)).toEqual(['uno']);
  expect((await cli(['tags', 'list'])).stdout).toContain('uno');
});

describe('query flags', () => {
  test('--tag narrows the files a tag goes on', async () => {
    const paths = await writeFiles({ 'a.txt': 'a', 'b.txt': 'b' });
    await writeTags(paths['a.txt']!, ['doc-type:invoice']);
    await cli(['scan', root]);
    await cli(['tags', 'add', root, 'x', '--tag', 'doc-type:invoice', '--apply']);
    expect(await readTags(paths['b.txt']!)).toEqual([]);
    expect(await readTags(paths['a.txt']!)).toEqual(['doc-type:invoice', 'x']);
  });

  test('--tag-match any widens a repeated --tag, and an unknown mode is exit 2', async () => {
    const paths = await writeFiles({ 'a.txt': 'a', 'b.txt': 'b' });
    await writeTags(paths['a.txt']!, ['topic:law']);
    await writeTags(paths['b.txt']!, ['topic:tax']);
    await cli(['scan', root]);
    const bothTags = ['--tag', 'topic:law', '--tag', 'topic:tax'];
    expect((await cli(['search', ...bothTags])).stdout).not.toContain('a.txt');
    const eitherTag = (await cli(['search', ...bothTags, '--tag-match', 'any'])).stdout;
    expect(eitherTag).toContain('a.txt');
    expect(eitherTag).toContain('b.txt');
    expect((await cli(['search', ...bothTags, '--tag-match', 'some'])).code).toBe(2);
  });
});

describe('the tag tree', () => {
  test('tree prints levels, move takes the children along, and rename --children too', async () => {
    const paths = await writeFiles({ 'a.txt': 'a', 'b.txt': 'b' });
    await writeTags(paths['a.txt']!, ['topic:tax', 'topic:tax/vat']);
    await writeTags(paths['b.txt']!, ['topic:tax']);
    await cli(['scan', root]);
    const tree = (await cli(['tags', 'tree'])).stdout;
    expect(lines(tree)).toEqual([
      'topic:                          2',
      '  tax                           2',
      '    vat                         1',
    ]);

    const moved = await cli(['tags', 'move', 'topic:tax', '--under', 'topic:finance', '--apply']);
    expect(moved.stdout).toContain('Plan');
    expect(await readTags(paths['a.txt']!)).toEqual(['topic:finance/tax', 'topic:finance/tax/vat']);
    await cli(['tags', 'rename', 'topic:finance', 'topic:money', '--children', '--apply']);
    expect(await readTags(paths['b.txt']!)).toEqual(['topic:money/tax']);
    await cli(['tags', 'move', 'topic:money/tax', '--top', '--apply']);
    expect(await readTags(paths['a.txt']!)).toEqual(['topic:tax', 'topic:tax/vat']);
  });

  test('move needs one of --under and --top, and refuses a closed facet, with exit 2', async () => {
    const path = (await writeFiles({ 'a.txt': 'a' }))['a.txt']!;
    await writeTags(path, ['doc-type:invoice', 'topic:tax']);
    await cli(['scan', root]);
    expect((await cli(['tags', 'move', 'topic:tax'])).code).toBe(2);
    expect((await cli(['tags', 'move', 'topic:tax', '--top', '--under', 'topic:x'])).code).toBe(2);
    const closed = await cli(['tags', 'move', 'doc-type:invoice', '--top']);
    expect(closed.code).toBe(2);
    expect(closed.stderr).toContain('fixed');
  });

  test('a hostile tag is safe in text output, and kept in --json', async () => {
    const path = (await writeFiles({ 'a.txt': 'a' }))['a.txt']!;
    await cli(['scan', root]);
    const hostile = 'topic:\x1b]0;pwned\x07/x';
    // A foreign tag can hold what Jevonganize would never write, so plant it in the mirror.
    const db = openDb();
    db.addFileTags(db.fileByPath(path)!.id, [hostile], false);
    db.close();
    const text = await cli(['tags', 'move', hostile, '--under', 'topic:finance']);
    expect(text.code).toBe(0);
    expect(text.stdout).not.toContain('\x1b');
    expect(text.stdout).toContain('?]0;pwned?');
    const json = await cli(['tags', 'move', hostile, '--under', 'topic:finance', '--json']);
    const plan = JSON.parse(json.stdout) as Plan;
    expect(plan.renames).toEqual([{ from: hostile, to: 'topic:finance/x' }]);
    const tree = await cli(['tags', 'tree']);
    expect(tree.stdout).not.toContain('\x1b');
    const nodes = JSON.parse((await cli(['tags', 'tree', '--json'])).stdout) as TagNode[];
    expect(nodes[0]?.children[0]?.path).toBe('topic:\x1b]0;pwned\x07');
  });
});
