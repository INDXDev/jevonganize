import { describe, expect, test } from 'vitest';
import { callTool, waitForJob } from '../src/core/tools.ts';
import { ctx, idOf, proposeTag, root, scanned, setupToolContext } from './tools-helpers.ts';

setupToolContext();

describe('applying a plan twice at once', () => {
  test('one call gets it, so undo keeps every op', async () => {
    await scanned('a.txt', 'b.txt');
    const input = { query: { folder: root }, add: ['x'], title: 't' };
    const { id } = await callTool('propose_changes', input, ctx);
    const calls = await Promise.allSettled([
      callTool('apply_plan', { id }, ctx),
      callTool('apply_plan', { id }, ctx),
    ]);
    const started = calls.flatMap((call) => (call.status === 'fulfilled' ? [call.value] : []));
    expect(started).toHaveLength(1);
    await waitForJob(started[0]!.id);
    expect((await callTool('get_plan', { id }, ctx)).ops).toHaveLength(2);
  });

  test('a plan part-way through a crash cannot be discarded, so its undo survives', async () => {
    await scanned('a.txt');
    const { id } = await proposeTag();
    ctx.db.addPlanOp(id, { file_id: idOf('a.txt'), add: ['x'], remove: [] });
    await expect(callTool('discard_plan', { id }, ctx)).rejects.toThrow('Apply it');
  });

  test('list_plans brings back a plan whose apply died', async () => {
    await scanned('a.txt');
    const { id } = await proposeTag();
    ctx.db.claimPlan(id, 1);
    expect(await callTool('list_plans', { status: 'proposed' }, ctx)).toMatchObject([{ id }]);
  });
});

describe('plans', () => {
  test('apply takes only an id, and refuses a plan twice or a wrong status', async () => {
    await scanned('a.txt');
    const plan = await proposeTag();
    await expect(callTool('apply_plan', { id: plan.id, ops: [] } as never, ctx)).rejects.toThrow(
      'unknown key',
    );
    await expect(callTool('undo_plan', { id: plan.id }, ctx)).rejects.toThrow('proposed');
    const job = await callTool('apply_plan', { id: plan.id }, ctx);
    await expect(callTool('apply_plan', { id: plan.id }, ctx)).rejects.toThrow(/is appl(y|ied)/);
    expect(await waitForJob(job.id)).toMatchObject({ status: 'done', plan_id: plan.id });
    await expect(callTool('apply_plan', { id: plan.id }, ctx)).rejects.toThrow('applied');
    await expect(callTool('discard_plan', { id: plan.id }, ctx)).rejects.toThrow('stays');
    await expect(callTool('get_plan', { id: 'none' }, ctx)).rejects.toThrow('no plan');
  });

  test('discard drops a proposed plan, and the list hides ops', async () => {
    await scanned('a.txt');
    const plan = await proposeTag();
    expect(await callTool('list_plans', { status: 'proposed' }, ctx)).toMatchObject([
      { id: plan.id, ops: [] },
    ]);
    await callTool('discard_plan', { id: plan.id }, ctx);
    expect(await callTool('list_plans', {}, ctx)).toEqual([]);
  });
});

describe('jobs', () => {
  test('a job says when it started, and vocabulary is listed', async () => {
    const before = Date.now();
    const job = await callTool('scan', {}, ctx);
    expect(job.started_at).toBeGreaterThanOrEqual(before);
    await waitForJob(job.id);
    ctx.db.setVocabulary('topic', 'rugby', 'active');
    expect(await callTool('list_vocabulary', {}, ctx)).toEqual([
      { facet: 'topic', value: 'rugby', state: 'active' },
    ]);
  });

  test('cancel_job refuses a job that does not exist', async () => {
    await expect(callTool('cancel_job', { id: 'x' }, ctx)).rejects.toThrow('no job');
    await expect(waitForJob('x')).rejects.toThrow('no job');
  });
});
