import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { readTags } from '../src/core/tags.ts';
import { callTool, type Context, tools, waitForJob } from '../src/core/tools.ts';
import { startJob } from '../src/core/tools/jobs.ts';
import type { Job } from '../src/types.ts';
import type { ToolName } from '../src/tool-map.ts';
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

/** One row of the tool table in docs/contracts.md: name, writes, agent and approval columns. */
const CONTRACT_ROW = /^\| `(\w+)` \|.*\| (.+?) \| (yes|no|yes, with approval) \|$/gm;

/** Reads the table out of the contract, so code and document cannot drift. */
async function contractRows() {
  const text = await readFile(new URL('../docs/contracts.md', import.meta.url), 'utf8');
  return [...text.matchAll(CONTRACT_ROW)].map(([, name = '', writes = '', agent = '']) => ({
    name: name as ToolName,
    writes: writes !== 'no',
    agent: agent !== 'no',
    approval: agent === 'yes, with approval',
  }));
}

/** Whether a path under src/web is UI source, and not a dev mock. */
const isUiSource = (name: string) => /\.tsx?$/.test(name) && !name.startsWith('dev');

/** The tools docs/ui.md lists as waiting for their screen. */
async function toolsWaitingForUi() {
  const text = await readFile(new URL('../docs/ui.md', import.meta.url), 'utf8');
  const start = text.indexOf('### Tools waiting for their screen');
  const end = text.indexOf('\n## ', start);
  const section = start < 0 ? '' : text.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^\| `(\w+)` \|/gm)].map(([, name = '']) => name);
}

/** Every source file of the UI, dev mocks aside, as one string. */
async function webSource() {
  const dir = join(import.meta.dirname, '../src/web');
  const names = (await readdir(dir, { recursive: true })).filter(isUiSource);
  const sources = await Promise.all(names.map((name) => readFile(join(dir, name), 'utf8')));
  return sources.join();
}

/** Starts a job that reports 1,000 steps in a burst, then grows past its total and waits. */
function startBurstyJob(emit: Context['emit'], waiting: Promise<void>) {
  return startJob('apply', { ...ctx, emit }, async (run) => {
    for (let done = 1; done <= 1000; done++) run.update({ done, current: `file ${done}` });
    run.update({ total: 1000 });
    run.update({ done: 1001 });
    vi.advanceTimersByTime(300);
    await waiting;
  });
}

test('job progress sends few progress events, and every other change at once', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const seen: Job[] = [];
  const recordJobs: Context['emit'] = (event) => {
    if (event.type === 'job') seen.push(event.job);
  };
  const { promise: waiting, resolve: release } = Promise.withResolvers<void>();
  const { id } = startBurstyJob(recordJobs, waiting);

  await vi.waitUntil(() => seen.length >= 3);
  expect(seen.map((job) => job.done)).toEqual([1, 1000, 1001]);
  release();
  expect(await waitForJob(id)).toMatchObject({ status: 'done', done: 1001 });
  expect(seen.at(-1)).toMatchObject({ status: 'done', current: undefined });
  vi.useRealTimers();
});

describe('the approval gate on what only a person may drop', () => {
  test('a model cannot resolve review items, and a person can', async () => {
    await scanned('a.txt');
    addReview('lost', 'restore');
    const dropAll = { ids: ids(), accept: false };
    await expect(callTool('resolve_reviews', dropAll, as('chat'))).rejects.toThrow('approve');
    await expect(callTool('resolve_reviews', dropAll, as('mcp'))).rejects.toThrow('approve');
    expect(ids()).toHaveLength(1);
    await callTool('resolve_reviews', dropAll, as('ui'));
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
  test('every tool has a place in the UI, or is listed as waiting for one', async () => {
    const web = await webSource();
    const missingFromUi = Object.keys(tools).filter((name) => !web.includes(`'${name}'`));
    // Both ways: a tool that gains its screen leaves the list.
    expect(missingFromUi.toSorted()).toEqual((await toolsWaitingForUi()).toSorted());
  });

  test('matches docs/contracts.md row by row, with no tool missing or extra', async () => {
    const rows = await contractRows();
    expect(rows.map((row) => row.name).toSorted()).toEqual(Object.keys(tools).toSorted());
    for (const row of rows) {
      const tool = tools[row.name];
      const { writes, agent } = tool;
      expect({ name: row.name, writes, agent, approval: 'approval' in tool }).toEqual(row);
    }
  });

  test.each([
    'set_api_key',
    'get_config',
    'set_config',
    'add_library',
    'set_favorite_tag',
  ] as const)(
    '%s, a key, config, folder or saved-state tool, is not offered to a model',
    (name) => {
      expect(tools[name].agent).toBe(false);
    },
  );
});

describe('entry point', () => {
  test('validates with the schema, naming the tool, as a UserError', async () => {
    const badInput = callTool('similar_files', { id: 'x' } as never, ctx);
    await expect(badInput).rejects.toThrow(UserError);
    await expect(badInput).rejects.toThrow('similar_files');
    await expect(callTool('status', { extra: 1 } as never, ctx)).rejects.toThrow('unknown key');
  });

  test.each(['chat', 'mcp'] as const)(
    'a %s caller cannot reach agent: false, nor approval tools without approval',
    async (caller) => {
      await scanned('a.txt');
      const plan = await proposeTag();
      await expect(callTool('get_config', {}, as(caller))).rejects.toThrow('not offered');
      await expect(callTool('apply_plan', { id: plan.id }, as(caller))).rejects.toThrow('approve');
      expect(await readTags(at('a.txt'))).toEqual([]);
    },
  );

  test('a model caller with approval can apply a plan, written to disk', async () => {
    await scanned('a.txt');
    const plan = await proposeTag();
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
