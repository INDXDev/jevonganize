// First, so its mocks are in place before anything loads core/tools.ts.
import { at, ctx, type DoDecide, mock, organize, scan, setupOrganize } from './organize-helpers.ts';
import { writeFile } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { refreshReason } from '../src/core/refresh-check.ts';
import { wordsOf } from '../src/core/refresh-signals.ts';
import { findCandidates, refreshQuestion } from '../src/core/tag-refresh.ts';
import { writeTags } from '../src/core/tags.ts';
import { CANDIDATES, candidatesFor, library, names, TAG } from './tag-refresh-helpers.ts';

setupOrganize();

/** The candidates of the library, keyed by file name. */
async function candidatesByName() {
  const found = await candidatesFor();
  return Object.fromEntries(found.candidates.map((candidate) => [candidate.name, candidate]));
}

test('text, co-occurring tags and file names find files, and tagged or rejected ones stay out', async () => {
  await library();
  const found = await candidatesFor();
  expect(found).toMatchObject({ tag: TAG, tagged: 2, seeds: 2, tags: ['party:acme'] });
  expect(found.terms).toEqual(expect.arrayContaining(['invoice', 'total']));
  expect(names(found).toSorted()).toEqual(CANDIDATES);
});

test('each candidate shows the signals that found it', async () => {
  await library();
  const byName = await candidatesByName();
  expect(byName['c-text.txt']!.signals.terms).toEqual(expect.arrayContaining(['invoice']));
  expect(byName['c-tags.txt']!.signals).toMatchObject({ tags: ['party:acme'] });
  expect(byName['c-tags.txt']!.signals.similar).toBeGreaterThan(0);
  expect(byName['old-receipts.txt']!.signals).toMatchObject({ name: true, terms: [] });
});

test('a name alone counts least', async () => {
  await library();
  const found = await candidatesFor();
  expect(found.candidates.at(-1)!.name).toBe('old-receipts.txt');
});

test('finding estimates the cost of a check and sends nothing', async () => {
  await library();
  const doDecide = vi.fn<DoDecide>();
  mock.doDecide = doDecide;
  const found = await candidatesFor();
  expect(found.estimate).toMatchObject({ files: 3, facets: 1 });
  expect(found.estimate.tokens).toBeGreaterThan(0);
  expect(doDecide).not.toHaveBeenCalled();
});

test('ranks the same way every time, highest score first', async () => {
  await library();
  const first = await candidatesFor();
  expect(await candidatesFor()).toEqual(first);
  const scores = first.candidates.map((candidate) => candidate.score);
  expect(scores).toEqual(scores.toSorted((a, b) => b - a));
});

test('honours the limit, keeping the top of the ranking', async () => {
  await library();
  const all = await candidatesFor();
  const limited = await candidatesFor({ tag: TAG, limit: 1 });
  expect(limited.candidates).toEqual(all.candidates.slice(0, 1));
});

test('another value of a single-valued facet rules a file out', async () => {
  for (const name of ['a.txt', 'b.txt', 'c.txt']) {
    await writeFile(at(name), 'invoice total amount due');
  }
  await writeTags(at('a.txt'), ['doc-type:invoice']);
  await writeTags(at('b.txt'), ['doc-type:receipt']);
  await scan();
  await organize();
  const found = await findCandidates(ctx.db, ctx.config, 'doc-type:invoice');
  expect(names(found)).toEqual(['c.txt']);
});

test('the question carries the tag and its facet definition, in trusted words', async () => {
  const { facet, owner, scope } = await refreshQuestion(ctx.config, 'doc-type:invoice');
  expect(owner?.id).toBe('doc-type');
  expect(scope).toEqual({ tag: 'doc-type:invoice', facet: 'doc-type' });
  expect(facet).toMatchObject({ kind: 'flag', weight: 0 });
  expect(facet.instructions).toContain('"doc-type:invoice"');
  expect(facet.instructions).toContain(owner!.values!.invoice);
});

test('the question of a tag no facet owns is scoped to the tag alone', async () => {
  const plain = await refreshQuestion(ctx.config, TAG);
  expect(plain.scope).toEqual({ tag: TAG });
});

test('words safe in a search: letters and digits only, never control characters', () => {
  const words = wordsOf('Invoice \u001b]0;pwned\u0007 "quoted" OR 12345 請求書の合計 ab');
  expect([...words].toSorted()).toEqual(['invoice', 'pwned', 'quoted', '請求書'].toSorted());
  for (const word of words) expect(word).toMatch(/^[\p{L}\p{N}]+$/u);
});

test('the reason names every signal that found a file', () => {
  const signals = { terms: ['a'], tags: ['t:x'], similar: 0.1, name: true };
  expect(refreshReason({ signals })).toBe('Refresh: words a; tags t:x; similar files; file name');
});
