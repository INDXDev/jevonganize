import { writeFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import { at, ctx, idOf, scanAll, scanned, setupToolContext } from './tools-helpers.ts';

setupToolContext();

const cleanupReport = () => callTool('cleanup_report', {}, ctx);

/** Tags whose near-duplicates hinge on punctuation, prefixes and Unicode. */
const TRICKY_TAGS = [
  'project:a',
  'project:a-b',
  'project:a-b-c',
  'project:ab',
  'project:a_b',
  'topic:a',
  'topic:a-b',
  'topic:Ａ',
  'topic:日本-語',
  'topic:日本語',
  'plain',
  'plain-more',
  'plain_more',
];

/** 100 tags spread over seven facets, none a near-duplicate of another. */
const FILLER_TAGS = Array.from({ length: 100 }, (_, i) => `facet-${i % 7}:value-${i}`);

/** A tag with its punctuation and case dropped. */
const bareTag = (tag: string) => tag.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The facet a tag belongs to, as cleanup groups them. */
const facetOf = (tag: string) =>
  tag.startsWith('flag:') ? tag.slice(5) : tag.slice(0, Math.max(tag.indexOf(':'), 0));

/** Whether two tags in one facet differ only in punctuation, or one extends the other. */
function isNearDuplicatePair(one: string, two: string): boolean {
  if (facetOf(one) !== facetOf(two)) return false;
  const sameBare = bareTag(one) === bareTag(two);
  return sameBare || one.startsWith(`${two}-`) || two.startsWith(`${one}-`);
}

/** Every near-duplicate pair, found by comparing each pair in order: the slow reference. */
function nearDuplicatesByBruteForce(counts: { tag: string; count: number }[]) {
  const pairs: { tags: string[]; files: number }[] = [];
  counts.forEach((one, index) => {
    for (const two of counts.slice(index + 1)) {
      if (isNearDuplicatePair(one.tag, two.tag))
        pairs.push({ tags: [one.tag, two.tag], files: one.count + two.count });
    }
  });
  return pairs;
}

/** Ten files tagged `doc-type:document`, the first also with two near-duplicate project tags. */
async function scanTenDocuments() {
  for (let index = 0; index < 10; index++) {
    const name = `${index}.txt`;
    await writeFile(at(name), name);
    await writeTags(at(name), ['doc-type:document']);
  }
  await writeTags(at('0.txt'), ['doc-type:document', 'project:acme', 'project:acme-corp']);
  await scanAll();
}

test('cleanup finds near-duplicates, one-file tags and over-broad tags', async () => {
  await scanTenDocuments();
  const report = await cleanupReport();
  expect(report.near_duplicates).toEqual([
    { tags: ['project:acme', 'project:acme-corp'], files: 2 },
  ]);
  expect(report.single_use.map((row) => row.tag)).toEqual(['project:acme', 'project:acme-corp']);
  expect(report.over_broad.map((row) => row.tag)).toEqual(['doc-type:document']);
});

test('near-duplicates match a pair-by-pair search, order included, on tricky tags', async () => {
  await scanned('cleanup.txt');
  ctx.db.addFileTags(idOf('cleanup.txt'), [...TRICKY_TAGS, ...FILLER_TAGS], false);
  const expected = nearDuplicatesByBruteForce(ctx.db.tagCounts());
  expect((await cleanupReport()).near_duplicates).toEqual(expected);
});

test('cleanup_report stays quick at 3,000 tags', async () => {
  await scanned('a.txt');
  const manyTags = Array.from({ length: 3000 }, (_, n) => `topic:label-${n}`);
  ctx.db.addFileTags(idOf('a.txt'), manyTags, false);
  const started = performance.now();
  const report = await cleanupReport();
  expect(performance.now() - started).toBeLessThan(2500); // under coverage, on a busy machine
  expect(report.single_use).toHaveLength(3000);
});

test('redundant parents are listed, and their plan removes only the parent', async () => {
  const tagsByName = {
    'a.txt': ['topic:finance', 'topic:finance/tax'],
    'b.txt': ['topic:finance', 'topic:finance/tax/vat'],
    'c.txt': ['topic:finance'],
    'd.txt': ['topic:finance/tax'],
  };
  for (const [name, tags] of Object.entries(tagsByName)) {
    await writeFile(at(name), name);
    await writeTags(at(name), tags);
  }
  await scanAll();
  expect((await cleanupReport()).redundant_parents).toEqual([
    { tag: 'topic:finance/tax', parent: 'topic:finance', files: 1 },
    { tag: 'topic:finance/tax/vat', parent: 'topic:finance', files: 1 },
  ]);

  const query = { tags: ['topic:finance/tax'] };
  const tidy = { query, remove: ['topic:finance'], title: 'tidy' };
  const plan = await callTool('propose_changes', tidy, ctx);
  await waitForJob((await callTool('apply_plan', { id: plan.id }, ctx)).id);
  const after = await Promise.all(Object.keys(tagsByName).map((name) => readTags(at(name))));
  expect(after).toEqual([
    ['topic:finance/tax'],
    ['topic:finance/tax/vat'],
    ['topic:finance'],
    ['topic:finance/tax'],
  ]);
  expect((await cleanupReport()).redundant_parents).toEqual([]);
});
