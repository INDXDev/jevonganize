import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDb } from '../src/core/db.ts';
import { cli, root, scanFiles, setupCliHome } from './cli-helpers.ts';

setupCliHome();

const HOSTILE_TAG = 'x:\x1b]0;pwned\x07';

test('report library prints a hostile tag sanitized, and --json keeps it', async () => {
  await scanFiles({ 'a.txt': 'text' });
  // A tag on disk cannot hold control characters, so the index is given one straight away.
  const db = openDb();
  db.addFileTags(db.fileByPath(join(root, 'a.txt'))!.id, [HOSTILE_TAG], false);
  db.close();
  const text = await cli(['report', 'library']);
  expect(text.code).toBe(0);
  expect(text.stdout).not.toContain('\x1b');
  expect(text.stdout).toContain('Plans: 0 applied, 0 undone, 0 proposed');
  const json = await cli(['report', 'library', '--json']);
  const report = JSON.parse(json.stdout) as { top_tags: { tag: string }[] };
  expect(report.top_tags.map((row) => row.tag)).toEqual([HOSTILE_TAG]);
});

test('report usage starts at zero, and a bad date or bucket is a usage error', async () => {
  const empty = await cli(['report', 'usage', '--since', '2026-11-01', '--bucket', 'week']);
  expect(empty.code).toBe(0);
  expect(empty.stdout).toContain('0 calls');
  expect((await cli(['report', 'usage', '--since', 'yesterday'])).code).toBe(2);
  expect((await cli(['report', 'usage', '--bucket', 'year'])).code).toBe(2);
});
