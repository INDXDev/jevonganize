// First, so its mocks are in place before anything loads core/tools.ts.
import {
  answering,
  at,
  ctx,
  type DoDecide,
  fileId,
  mock,
  setupOrganize,
} from './organize-helpers.ts';
import { expect, test, vi } from 'vitest';
import { readTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import { candidatesFor, library, refresh, TAG } from './tag-refresh-helpers.ts';

setupOrganize();

/** The model says yes to every file it is asked about. */
const sayYes = () => answering('invoice', 0.99, 0.9);
/** The model says no to every file it is asked about. */
const sayNo = () => answering('invoice', 0.99, 0.1);

/** Accepts the review of one file and applies the plan it makes. */
async function acceptReviewOf(name: string) {
  const item = ctx.db.listReviews({ tag: TAG }).find((entry) => entry.file_id === fileId(name))!;
  const plan = await callTool('resolve_reviews', { ids: [item.id], accept: true }, ctx);
  await waitForJob((await callTool('apply_plan', { id: plan!.id }, ctx)).id);
}

test('asks the decision model about each candidate, with the tag in the question', async () => {
  await library();
  const doDecide = sayYes();
  mock.doDecide = doDecide;
  const job = await refresh();
  expect(job).toMatchObject({ kind: 'refresh', status: 'done', total: 3, reviews: 3, tag: TAG });
  expect(doDecide).toHaveBeenCalledTimes(3);
  const sent = JSON.stringify(doDecide.mock.calls[0]![0].questions);
  expect(sent).toContain('\\"receipts\\"');
});

test('queues each yes for review and writes no tag', async () => {
  await library();
  mock.doDecide = sayYes();
  await refresh();
  const items = ctx.db.listReviews({ tag: TAG });
  expect(items).toHaveLength(3);
  const allRefreshSuggestions = items.every(
    (item) => item.kind === 'suggest' && item.reason.startsWith('Refresh:'),
  );
  expect(allRefreshSuggestions).toBe(true);
  expect(await readTags(at('c-text.txt'))).toEqual([]);
});

test('a file under review is left out of the next refresh', async () => {
  await library();
  mock.doDecide = sayYes();
  await refresh();
  expect((await candidatesFor()).candidates).toEqual([]);
});

test('an accepted review writes the tag to that file only, read back', async () => {
  await library();
  mock.doDecide = sayYes();
  await refresh();
  await acceptReviewOf('c-text.txt');
  expect(await readTags(at('c-text.txt'))).toEqual([TAG]);
  expect(await readTags(at('c-tags.txt'))).toEqual(['party:acme']);
});

test('a no is cached: the same content is never paid for twice', async () => {
  await library();
  const doDecide = sayNo();
  mock.doDecide = doDecide;
  expect(await refresh()).toMatchObject({ status: 'done', reviews: 0 });
  expect(doDecide).toHaveBeenCalledTimes(3);
  await refresh();
  expect(doDecide).toHaveBeenCalledTimes(3);
});

test('a cached no counts as checked, and the file is no longer a candidate', async () => {
  await library();
  mock.doDecide = sayNo();
  await refresh();
  ctx.config.provider.model = 'm-default'; // the model the mock resolves, so keys match
  const found = await candidatesFor();
  expect(found.checked).toBe(3);
  expect(found.candidates).toEqual([]);
});

test('picks only the given files, and only from the candidates', async () => {
  await library();
  mock.doDecide = sayYes();
  const asked = [fileId('c-text.txt'), fileId('n-none.txt'), fileId('s1.txt')];
  expect(await refresh(asked)).toMatchObject({ total: 1, reviews: 1 });
  const reviewed = ctx.db.listReviews({ tag: TAG }).map((item) => item.file_id);
  expect(reviewed).toEqual([fileId('c-text.txt')]);
});

test.each(['chat', 'mcp'] as const)(
  '%s needs approval to check, and may look for candidates freely',
  async (caller) => {
    await library();
    const doDecide = vi.fn<DoDecide>();
    mock.doDecide = doDecide;
    const model = { ...ctx, caller };
    await expect(callTool('refresh_tag', { tag: TAG }, model)).rejects.toThrow('approve');
    const found = await callTool('refresh_candidates', { tag: TAG }, model);
    expect(found.candidates).toHaveLength(3);
    expect(doDecide).not.toHaveBeenCalled();
    expect(ctx.db.listReviews({ tag: TAG })).toEqual([]);
  },
);

test('with no key it refuses before anything is read or sent', async () => {
  await library();
  mock.noKey = true;
  const doDecide = vi.fn<DoDecide>();
  mock.doDecide = doDecide;
  await expect(callTool('refresh_tag', { tag: TAG }, ctx)).rejects.toThrow('no key');
  expect(doDecide).not.toHaveBeenCalled();
});
