import {
  answeredAll,
  answering,
  apiError,
  at,
  ctx,
  type DoDecide,
  mock,
  organize,
  organizedThenEdited,
  saveInPlace,
  scan,
  setupOrganize,
} from './organize-helpers.ts';
import { writeFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';

setupOrganize();

describe('provenance of refusals and review', () => {
  test('a refused facet keeps its tags', async () => {
    await organizedThenEdited();
    const refusing = vi.fn<DoDecide>(async ({ questions }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((id) => [id, { type: 'refusal' as const }]),
      ),
      usage: { inputTokens: 1 },
      warnings: [],
    }));
    mock.doDecide = refusing;
    const job = await organize();
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.removed).toEqual({});
  });

  test('a facet the model answered with `other` still drops the tag it no longer supports', async () => {
    await organizedThenEdited();
    mock.doDecide = answering('other');
    const job = await organize();
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.removed).toEqual({ 'doc-type:invoice': 1 });
  });

  test('a tag held back for review counts towards max_tags', async () => {
    await organizedThenEdited(['mine']);
    ctx.config.max_tags = 2;
    mock.doDecide = answering('invoice', 0.6, 0.99); // doc-type:invoice to review, flag to apply
    const job = await organize({}, ['doc-type', 'needs-action']);
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.added).toEqual({});
    expect(plan.summary.removed).toEqual({});
  });

  test('the cost of a refused call stays counted when the file then fails', async () => {
    await writeFile(at('a.txt'), 'text');
    await scan();
    let calls = 0;
    mock.doDecide = vi.fn<DoDecide>(async ({ questions }) => {
      if (++calls > 1) throw apiError(400);
      const [first = ''] = Object.keys(questions);
      return {
        answers: { ...answeredAll(questions), [first]: { type: 'refusal' as const } },
        usage: { inputTokens: 100 },
        warnings: [],
      };
    });
    const job = await organize({}, ['doc-type', 'needs-action']);
    expect(job).toMatchObject({ failed: 1, tokens: 100 });
  });
});

describe('provenance of replaced tags', () => {
  test('a new answer replaces a tag the app wrote, in a plan, and never a person’s', async () => {
    await writeFile(at('a.txt'), 'first');
    await scan();
    const first = await organize();
    await waitForJob((await callTool('apply_plan', { id: first.plan_id! }, ctx)).id);

    await saveInPlace('a.txt', 'second version');
    await scan();
    mock.doDecide = answering('receipt');
    const second = await organize();
    const plan = await callTool('get_plan', { id: second.plan_id! }, ctx);
    expect(plan.ops).toMatchObject([{ add: ['doc-type:receipt'], remove: ['doc-type:invoice'] }]);
  });

  test('a person’s tag in a single-valued facet blocks the answer', async () => {
    await writeFile(at('a.txt'), 'x');
    await writeTags(at('a.txt'), ['doc-type:contract']);
    await scan();
    const job = await organize();
    expect((await callTool('get_plan', { id: job.plan_id! }, ctx)).ops).toEqual([]);
  });

  test('an unchanged rerun proposes nothing', async () => {
    await writeFile(at('a.txt'), 'x');
    await scan();
    const first = await organize();
    await waitForJob((await callTool('apply_plan', { id: first.plan_id! }, ctx)).id);
    const second = await organize();
    expect((await callTool('get_plan', { id: second.plan_id! }, ctx)).ops).toEqual([]);
  });
});
