import { writeFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import {
  answering,
  at,
  ctx,
  type DoDecide,
  fileId,
  mock,
  organize,
  scan,
  setupOrganize,
} from './organize-helpers.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import {
  findCandidates,
  refreshQuestion,
  refreshReason,
  wordsOf,
} from '../src/core/tag-refresh.ts';
import type { RefreshCandidates } from '../src/types.ts';

setupOrganize();

const TAG = 'receipts';

/** Two tagged files, and files that each signal should, or should not, find. */
async function library() {
  const files: Record<string, string> = {
    's1.txt': 'invoice total amount due from acme corporation',
    's2.txt': 'invoice total amount due on payment',
    'c-text.txt': 'invoice total amount due for march',
    'c-tags.txt': 'holiday photos from the beach',
    'old-receipts.txt': 'random words here',
    'n-none.txt': 'a short poem about the quiet sea',
    'r-rejected.txt': 'invoice total amount due again',
  };
  for (const [name, text] of Object.entries(files)) await writeFile(at(name), text);
  await writeTags(at('s1.txt'), [TAG, 'party:acme']);
  await writeTags(at('s2.txt'), [TAG, 'party:acme']);
  await writeTags(at('c-tags.txt'), ['party:acme']);
  await scan();
  await organize(); // stores the searchable text, and each file's state
  ctx.db.rejectTag(fileId('r-rejected.txt'), TAG, 'a person removed it');
  ctx.db.refreshIdf();
}

const names = (found: RefreshCandidates) => found.candidates.map((c) => c.name);

describe('finding candidates', () => {
  test('text, co-occurring tags and file names find files, and tagged or rejected ones stay out', async () => {
    await library();
    const doDecide = vi.fn<DoDecide>();
    mock.doDecide = doDecide;
    const found = await callTool('refresh_candidates', { tag: TAG }, ctx);
    expect(found).toMatchObject({ tag: TAG, tagged: 2, seeds: 2, tags: ['party:acme'] });
    expect(found.terms).toEqual(expect.arrayContaining(['invoice', 'total']));
    expect(names(found).toSorted()).toEqual(['c-tags.txt', 'c-text.txt', 'old-receipts.txt']);
    const byName = Object.fromEntries(found.candidates.map((c) => [c.name, c]));
    expect(byName['c-text.txt']!.signals.terms).toEqual(expect.arrayContaining(['invoice']));
    expect(byName['c-tags.txt']!.signals).toMatchObject({ tags: ['party:acme'] });
    expect(byName['c-tags.txt']!.signals.similar).toBeGreaterThan(0);
    expect(byName['old-receipts.txt']!.signals).toMatchObject({ name: true, terms: [] });
    expect(found.candidates.at(-1)!.name).toBe('old-receipts.txt'); // a name alone counts least
    expect(found.estimate).toMatchObject({ files: 3, facets: 1 });
    expect(found.estimate.tokens).toBeGreaterThan(0);
    expect(doDecide).not.toHaveBeenCalled(); // finding sends nothing
  });

  test('ranks the same way every time, and honours the limit', async () => {
    await library();
    const first = await callTool('refresh_candidates', { tag: TAG }, ctx);
    const again = await callTool('refresh_candidates', { tag: TAG }, ctx);
    expect(again).toEqual(first);
    const scores = first.candidates.map((c) => c.score);
    expect(scores).toEqual(scores.toSorted((a, b) => b - a));
    expect((await callTool('refresh_candidates', { tag: TAG, limit: 1 }, ctx)).candidates).toEqual(
      first.candidates.slice(0, 1),
    );
  });

  test('another value of a single-valued facet rules a file out', async () => {
    await writeFile(at('a.txt'), 'invoice total amount due');
    await writeFile(at('b.txt'), 'invoice total amount due');
    await writeFile(at('c.txt'), 'invoice total amount due');
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
    const plain = await refreshQuestion(ctx.config, TAG);
    expect(plain.scope).toEqual({ tag: TAG });
  });

  test('words safe in a search: letters and digits only, never control characters', () => {
    const words = wordsOf('Invoice \u001b]0;pwned\u0007 "quoted" OR 12345 請求書の合計 ab');
    expect([...words].toSorted()).toEqual(['invoice', 'pwned', 'quoted', '請求書'].toSorted());
    for (const word of words) expect(word).toMatch(/^[\p{L}\p{N}]+$/u);
    const reason = refreshReason({
      signals: { terms: ['a'], tags: ['t:x'], similar: 0.1, name: true },
    });
    expect(reason).toBe('Refresh: words a; tags t:x; similar files; file name');
  });
});

describe('checking candidates', () => {
  test('asks the decision model, queues yeses for review, and writes no tag until accepted', async () => {
    await library();
    const doDecide = answering('invoice', 0.99, 0.9);
    mock.doDecide = doDecide;
    const job = await waitForJob((await callTool('refresh_tag', { tag: TAG }, ctx)).id);
    expect(job).toMatchObject({ kind: 'refresh', status: 'done', total: 3, reviews: 3, tag: TAG });
    expect(doDecide).toHaveBeenCalledTimes(3);
    const sent = JSON.stringify(doDecide.mock.calls[0]![0].questions);
    expect(sent).toContain('\\"receipts\\"');
    const items = ctx.db.listReviews({ tag: TAG });
    expect(items).toHaveLength(3);
    expect(
      items.every((item) => item.kind === 'suggest' && item.reason.startsWith('Refresh:')),
    ).toBe(true);
    expect(await readTags(at('c-text.txt'))).toEqual([]);

    // Each file is under review now, so the next refresh leaves it out.
    expect((await callTool('refresh_candidates', { tag: TAG }, ctx)).candidates).toEqual([]);

    const item = items.find((entry) => entry.file_id === fileId('c-text.txt'))!;
    const plan = await callTool('resolve_reviews', { ids: [item.id], accept: true }, ctx);
    await waitForJob((await callTool('apply_plan', { id: plan!.id }, ctx)).id);
    expect(await readTags(at('c-text.txt'))).toEqual([TAG]);
    expect(await readTags(at('c-tags.txt'))).toEqual(['party:acme']);
  });

  test('a no is cached: the same content is never paid for twice, and counts as checked', async () => {
    await library();
    const doDecide = answering('invoice', 0.99, 0.1);
    mock.doDecide = doDecide;
    const job = await waitForJob((await callTool('refresh_tag', { tag: TAG }, ctx)).id);
    expect(job).toMatchObject({ status: 'done', reviews: 0 });
    expect(doDecide).toHaveBeenCalledTimes(3);
    await waitForJob((await callTool('refresh_tag', { tag: TAG }, ctx)).id);
    expect(doDecide).toHaveBeenCalledTimes(3);

    ctx.config.provider.model = 'm-default'; // the model the mock resolves, so keys match
    const found = await callTool('refresh_candidates', { tag: TAG }, ctx);
    expect(found.checked).toBe(3);
    expect(found.candidates).toEqual([]);
  });

  test('picks only the given files, and only from the candidates', async () => {
    await library();
    mock.doDecide = answering('invoice', 0.99, 0.9);
    const ids = [fileId('c-text.txt'), fileId('n-none.txt'), fileId('s1.txt')];
    const job = await waitForJob(
      (await callTool('refresh_tag', { tag: TAG, file_ids: ids }, ctx)).id,
    );
    expect(job).toMatchObject({ total: 1, reviews: 1 });
    expect(ctx.db.listReviews({ tag: TAG }).map((item) => item.file_id)).toEqual([
      fileId('c-text.txt'),
    ]);
  });

  test('a model needs approval to check, and may look for candidates freely', async () => {
    await library();
    const doDecide = vi.fn<DoDecide>();
    mock.doDecide = doDecide;
    for (const caller of ['chat', 'mcp'] as const) {
      const as = { ...ctx, caller };
      await expect(callTool('refresh_tag', { tag: TAG }, as)).rejects.toThrow('approve');
      expect((await callTool('refresh_candidates', { tag: TAG }, as)).candidates).toHaveLength(3);
    }
    expect(doDecide).not.toHaveBeenCalled();
    expect(ctx.db.listReviews({ tag: TAG })).toEqual([]);
  });

  test('with no key it refuses before anything is read or sent', async () => {
    await library();
    mock.noKey = true;
    const doDecide = vi.fn<DoDecide>();
    mock.doDecide = doDecide;
    await expect(callTool('refresh_tag', { tag: TAG }, ctx)).rejects.toThrow('no key');
    expect(doDecide).not.toHaveBeenCalled();
  });
});
