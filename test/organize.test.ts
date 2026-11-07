import {
  answering,
  at,
  ctx,
  decideSpy,
  events,
  FACETS,
  fileId,
  mock,
  organize,
  planOps,
  scanned,
  setupOrganize,
} from './organize-helpers.ts';
import { writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';

setupOrganize();

describe('end to end', () => {
  test('organize proposes a plan and writes nothing', async () => {
    const path = at('invoice.txt');
    await writeFile(path, 'Invoice 44 for Acme');
    await writeTags(path, ['mine']);
    const { scan } = await scanned({});
    expect(scan).toMatchObject({ files: 1, added: 1 });

    const job = await organize();

    expect(job).toMatchObject({ status: 'done', done: 1, total: 1, tokens: 100 });
    expect(await readTags(path)).toEqual(['mine']);
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan).toMatchObject({ source: 'organize', status: 'proposed' });
    expect(plan.summary.added).toEqual({ 'doc-type:invoice': 1 });
  });

  test('applying the plan writes the tag to disk, and undo takes it off', async () => {
    const path = at('invoice.txt');
    await writeFile(path, 'Invoice 44 for Acme');
    await writeTags(path, ['mine']);
    await scanned({});
    const { plan_id: planId } = await organize();

    const applied = await waitForJob((await callTool('apply_plan', { id: planId! }, ctx)).id);
    expect(applied).toMatchObject({ status: 'done', failed: 0 });
    expect(await readTags(path)).toEqual(['doc-type:invoice', 'mine']);
    const aiTag = { tag: 'doc-type:invoice', ai: true };
    expect(ctx.db.fileTags(fileId('invoice.txt'))).toContainEqual(aiTag);

    await waitForJob((await callTool('undo_plan', { id: planId! }, ctx)).id);
    expect(await readTags(path)).toEqual(['mine']);
    expect((await callTool('get_plan', { id: planId! }, ctx)).status).toBe('undone');
  });
});

describe('thresholds', () => {
  test('a middle answer joins the plan by default', async () => {
    await scanned({ 'a.txt': 'text' });
    mock.doDecide = answering('invoice', 0.6);

    const job = await organize();

    expect((await planOps(job))[0]?.add).toEqual(['doc-type:invoice']);
    expect(await callTool('list_reviews', {}, ctx)).toEqual([]);
  });

  test('with a raised apply, the middle band goes to review, not the plan', async () => {
    ctx.config.thresholds.apply = 0.85;
    await scanned({ 'a.txt': 'text' });
    mock.doDecide = answering('invoice', 0.6);

    const job = await organize();

    expect(await planOps(job)).toEqual([]);
    const reviews = await callTool('list_reviews', {}, ctx);
    expect(reviews).toMatchObject([{ tag: 'doc-type:invoice', confidence: 0.6, kind: 'suggest' }]);
    expect(events).toContainEqual({ type: 'reviews', count: 1 });
  });

  test('an estimated answer never auto-applies, however confident', async () => {
    await scanned({ 'a.txt': 'text' });
    mock.native = false;

    const job = await organize();

    expect(await planOps(job)).toEqual([]);
    expect(await callTool('list_reviews', {}, ctx)).toHaveLength(1);
  });

  test('a rejected tag is not proposed again', async () => {
    await scanned({ 'a.txt': 'text' });
    ctx.db.rejectTag(fileId('a.txt'), 'doc-type:invoice', 'no');

    const job = await organize();

    expect(await planOps(job)).toEqual([]);
  });
});

describe('caching and cost', () => {
  test('estimate counts tokens for a file not yet answered', async () => {
    await scanned({ 'a.txt': 'text' });

    const estimate = await callTool('estimate', { query: {}, facets: FACETS }, ctx);

    expect(estimate).toMatchObject({ files: 1, cached: 0, facets: 2 });
    expect(estimate.tokens).toBeGreaterThan(0);
  });

  test('a second run reuses the stored answers and costs no call', async () => {
    await scanned({ 'a.txt': 'text' });

    await organize();
    expect(decideSpy()).toHaveBeenCalledTimes(1);
    await organize();
    expect(decideSpy()).toHaveBeenCalledTimes(1);
  });

  test('an organized file keeps its hash, its answers and its text in the index', async () => {
    await scanned({ 'a.txt': 'text' });

    await organize();

    const row = ctx.db.fileByPath(at('a.txt'))!;
    expect(row).toMatchObject({ status: 'organized', mime: 'text/plain' });
    expect(row.hash).toMatch(/^f1:[0-9a-f]{64}$/);
    // Answers are found only when the file links to them under the right key.
    expect(ctx.db.fileAnswers(row.id).length).toBeGreaterThan(0);
    expect(ctx.db.getContent(row.id)).toContain('text');
  });

  test('facets group by profile, with one decide each', async () => {
    const visionFlag: Parameters<typeof callTool<'save_facet'>>[1] = {
      id: 'seen',
      pack: 'mine',
      title: 'Seen',
      kind: 'flag',
      instructions: 'Q?',
      applies_to: [],
      weight: 1,
      profile: 'vision',
    };
    await callTool('save_facet', visionFlag, ctx);
    await scanned({ 'a.txt': 'text' });

    await organize({}, ['doc-type', 'seen']);

    expect(mock.profiles).toEqual([undefined, 'vision']);
    expect(decideSpy().mock.calls.length).toBe(2);
  });
});
