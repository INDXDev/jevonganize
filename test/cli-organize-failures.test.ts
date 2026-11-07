import { expect, test } from 'vitest';
import { readTags } from '../src/core/tags.ts';
import { cli, root, scanFiles, setupCliHome } from './cli-helpers.ts';
import { answerInvoice, useStubProvider } from './cli-provider-helpers.ts';

setupCliHome();
const provider = useStubProvider();

/** Organizes the library on `doc-type` alone. */
const organize = () => cli(['organize', root, '--facets', 'doc-type']);

test('every file failing is exit 2', async () => {
  await scanFiles({ 'a.txt': 'x' });
  provider.replyWith(() => 400);
  const { code, stderr } = await organize();
  expect(code).toBe(2);
  expect(stderr).toContain('Every file failed');
});

test('a rejected key is exit 2, and nothing is stored as a plan', async () => {
  await scanFiles({ 'a.txt': 'x' });
  provider.replyWith(() => 401);
  const { code, stderr } = await organize();
  expect(code).toBe(2);
  expect(stderr).toContain('rejected the API key');
  expect((await cli(['plans'])).stdout).toBe('');
});

test('an unsure answer goes to review, and accepting it writes the tag through a plan', async () => {
  const path = (await scanFiles({ 'a.txt': 'x' }))['a.txt']!;
  provider.replyWith((body) => ({ answers: answerInvoice(body, 0.6) }));
  await cli(['config', 'set', 'thresholds.apply', '0.85']);
  await organize();
  expect((await cli(['review'])).stdout).toContain('doc-type:invoice (1)');
  const accepted = await cli(['review', '--tag', 'doc-type:invoice', '--accept', 'all']);
  expect(accepted.stdout).toBe('Accepted 1 items.\n');
  expect(await readTags(path)).toEqual(['doc-type:invoice']);
});
