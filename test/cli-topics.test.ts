import { expect, test } from 'vitest';
import { cli, root, setupCliHome, writeFiles } from './cli-helpers.ts';
import { answerFirstTopics, useStubProvider } from './cli-provider-helpers.ts';

setupCliHome();
const provider = useStubProvider();

/** Picks three topics for the library. */
const pickThree = (...flags: string[]) => cli(['topics', 'pick', root, ...flags, '--limit', '3']);

test('topics pick starts from an unknown folder, and --dry-run adds nothing', async () => {
  provider.replyWith(answerFirstTopics);
  await writeFiles({ 'budget-2026.xlsx': 'x' });
  const dry = await pickThree('--dry-run');
  expect(dry.code).toBe(0);
  expect(dry.stdout.trim().split('\n')).toHaveLength(3);
  const again = await pickThree();
  expect(again.stdout).toBe(dry.stdout);
  const next = await pickThree();
  // The first three are active now, so they are not offered again.
  expect(next.stdout).not.toBe(dry.stdout);
});

test('setup chooses topics at first start, and skips names with no [ner] key', async () => {
  provider.replyWith(answerFirstTopics);
  await writeFiles({ 'budget-2026.xlsx': 'x' });
  const { code, stderr } = await cli(['setup', '--yes', '--folder', root, '--topics']);
  expect(code).toBe(0);
  expect(stderr).toContain('100 topics from 1 file names');
});

test('setup --yes alone sends nothing', async () => {
  provider.replyWith(answerFirstTopics);
  await writeFiles({ 'a.txt': 'x' });
  expect((await cli(['setup', '--yes', '--folder', root])).code).toBe(0);
  expect(provider.requests).toEqual([]);
});
