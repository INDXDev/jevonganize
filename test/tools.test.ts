import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { readTags } from '../src/core/tags.ts';
import { callTool, type Context, tools, waitForJob } from '../src/core/tools.ts';
import { startJob } from '../src/core/tools/jobs.ts';
import type { Job, ToolName } from '../src/types.ts';
import {
  addReview,
  as,
  at,
  ctx,
  idOf,
  ids,
  proposeTag,
  scanned,
  setupToolContext,
} from './tools-helpers.ts';

setupToolContext();

/** Reads the table out of the contract, so code and document cannot drift. */
async function contract() {
  const text = await readFile(new URL('../docs/contracts.md', import.meta.url), 'utf8');
  const rows = [...text.matchAll(/^\| `(\w+)` \|.*\| (.+?) \| (yes|no|yes, with approval) \|$/gm)];
  return rows.map(([, name = '', writes = '', agent = '']) => ({
    name: name as ToolName,
    writes: writes !== 'no',
    agent: agent !== 'no',
    approval: agent === 'yes, with approval',
  }));
}

/** Every source file of the UI, as one string. */
async function webSource() {
  const dir = join(import.meta.dirname, '../src/web');
  const names = (await readdir(dir, { recursive: true })).filter(
    (name) => /\.tsx?$/.test(name) && !name.startsWith('dev'),
  );
  return (await Promise.all(names.map((name) => readFile(join(dir, name), 'utf8')))).join();
}

describe('job progress', () => {
  test('sends few progress events, and every other change at once', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const seen: Job[] = [];
    const emit: Context['emit'] = (event) => {
      if (event.type === 'job') seen.push(event.job);
    };
    const { promise: waiting, resolve: release } = Promise.withResolvers<void>();
    const { id } = startJob('apply', { ...ctx, emit }, async (run) => {
      for (let done = 1; done <= 1000; done++) run.update({ done, current: `file ${done}` });
      run.update({ total: 1000 });
      run.update({ done: 1001 });
      vi.advanceTimersByTime(300);
      await waiting;
    });
    await vi.waitUntil(() => seen.length >= 3);
    expect(seen.map((job) => job.done)).toEqual([1, 1000, 1001]);
    release();
    const final = await waitForJob(id);
    expect(final).toMatchObject({ status: 'done', done: 1001 });
    expect(seen.at(-1)).toMatchObject({ status: 'done', current: undefined });
    vi.useRealTimers();
  });
});

describe('the approval gate on what only a person may drop', () => {
  test('a model cannot resolve review items, and a person can', async () => {
    await scanned('a.txt');
    addReview('lost', 'restore');
    const input = { ids: ids(), accept: false };
    await expect(callTool('resolve_reviews', input, as('chat'))).rejects.toThrow('approve');
    await expect(callTool('resolve_reviews', input, as('mcp'))).rejects.toThrow('approve');
    expect(ids()).toHaveLength(1);
    await callTool('resolve_reviews', input, as('ui'));
    expect(ids()).toEqual([]);
  });

  test('a model cannot discard a plan, and a person can', async () => {
    await scanned('a.txt');
    const { id } = await proposeTag();
    await expect(callTool('discard_plan', { id }, as('mcp'))).rejects.toThrow('approve');
    await callTool('discard_plan', { id }, as('cli'));
    expect(ctx.db.getPlan(id)).toBeUndefined();
  });
});

describe('the table', () => {
  test('every tool has a place in the UI', async () => {
    const web = await webSource();
    expect(Object.keys(tools).filter((name) => !web.includes(`'${name}'`))).toEqual([]);
  });

  test('matches docs/contracts.md row by row, with no tool missing or extra', async () => {
    const rows = await contract();
    expect(rows.map((row) => row.name).toSorted()).toEqual(Object.keys(tools).toSorted());
    for (const row of rows) {
      const tool = tools[row.name];
      const { writes, agent } = tool;
      expect({ name: row.name, writes, agent, approval: 'approval' in tool }).toEqual(row);
    }
  });

  test('no key, config or folder tool is offered to a model', () => {
    for (const name of ['set_api_key', 'get_config', 'set_config', 'add_library'] as const) {
      expect(tools[name].agent).toBe(false);
    }
  });
});

describe('entry point', () => {
  test('validates with the schema, naming the tool, as a UserError', async () => {
    const bad = callTool('similar_files', { id: 'x' } as never, ctx);
    await expect(bad).rejects.toThrow(UserError);
    await expect(bad).rejects.toThrow('similar_files');
    await expect(callTool('status', { extra: 1 } as never, ctx)).rejects.toThrow('unknown key');
  });

  test('a model caller cannot reach agent: false, nor approval tools without approval', async () => {
    await scanned('a.txt');
    const plan = await proposeTag();
    for (const caller of ['chat', 'mcp'] as const) {
      await expect(callTool('get_config', {}, as(caller))).rejects.toThrow('not offered');
      await expect(callTool('apply_plan', { id: plan.id }, as(caller))).rejects.toThrow('approve');
    }
    expect(await readTags(at('a.txt'))).toEqual([]);
    const job = await callTool('apply_plan', { id: plan.id }, as('mcp', true));
    await waitForJob(job.id);
    expect(await readTags(at('a.txt'))).toEqual(['x']);
  });

  test.each([
    ['cli', 'user'],
    ['ui', 'user'],
    ['chat', 'chat'],
    ['mcp', 'mcp'],
  ] as const)('caller %s sets Plan.source to %s', async (caller, source) => {
    await scanned('a.txt');
    const input = { file_ids: [idOf('a.txt')], add: ['x'], title: 't' };
    expect((await callTool('propose_changes', input, as(caller))).source).toBe(source);
    expect((await callTool('rename_tag', { from: 'x', to: 'y' }, as(caller))).source).toBe(source);
  });
});
