import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readTags } from '../src/core/tags.ts';
import { callTool, openContext, tools, waitForJob } from '../src/core/tools.ts';
import type { Plan } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;

vi.setConfig({ testTimeout: 30_000 }); // each test starts a real process

const home = useTempHome();
let child: ChildProcessWithoutNullStreams | undefined;
let root: string;

interface Reply {
  id: number;
  result?: {
    tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    content?: { text: string }[];
    isError?: boolean;
  };
  error?: unknown;
}

/** Starts the server through the CLI, and speaks newline-delimited JSON-RPC to it. */
async function connect(...flags: string[]) {
  const server = spawn(process.execPath, [CLI, 'mcp', ...flags], {
    env: { ...process.env, JEVONGANIZE_HOME: home() },
  });
  child = server;
  const pending = new Map<number, (reply: Reply) => void>();
  let buffer = '';
  const noise: string[] = [];
  server.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      try {
        const reply = JSON.parse(line) as Reply;
        pending.get(reply.id)?.(reply);
      } catch {
        noise.push(line);
      }
    }
  });
  let next = 1;
  const request = (method: string, params: unknown = {}) =>
    new Promise<Reply>((done) => {
      const id = next++;
      pending.set(id, done);
      server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
  );
  const call = async (name: string, args: unknown = {}) => {
    const { result } = await request('tools/call', { name, arguments: args });
    return { text: result?.content?.[0]?.text ?? '', isError: result?.isError };
  };
  return { request, call, noise };
}

async function proposed(): Promise<{ plan: Plan; path: string }> {
  const path = join(root, 'a.txt');
  await writeFile(path, 'hello');
  const ctx = await openContext('cli');
  await callTool('add_library', { path: root }, ctx);
  await waitForJob((await callTool('scan', {}, ctx)).id);
  const input = { query: { folder: root }, add: ['x'], title: 't' };
  const plan = await callTool('propose_changes', input, ctx);
  ctx.db.close();
  return { plan, path };
}

beforeEach(async () => {
  root = join(home(), 'library');
  await mkdir(root);
});

afterEach(() => {
  child?.kill();
});

test('lists exactly the agent tools, with read-only hints', async () => {
  const { request } = await connect();
  const listed = (await request('tools/list')).result?.tools ?? [];
  const agent = Object.entries(tools).filter(([, tool]) => tool.agent);
  expect(listed.map((tool) => tool.name).toSorted()).toEqual(
    agent.map(([name]) => name).toSorted(),
  );
  expect(listed.find((tool) => tool.name === 'search_files')?.annotations?.readOnlyHint).toBe(true);
  expect(listed.find((tool) => tool.name === 'apply_plan')?.annotations?.readOnlyHint).toBe(false);
  expect(listed.some((tool) => tool.name === 'set_api_key')).toBe(false);
});

test('a tool with agent: false cannot be called', async () => {
  const { request } = await connect();
  const reply = await request('tools/call', { name: 'get_config', arguments: {} });
  expect(reply.error ?? reply.result?.isError).toBeTruthy();
});

test('apply_plan returns needs_approval, does nothing, and the plan stays proposed', async () => {
  const { plan, path } = await proposed();
  const { call } = await connect();
  const { text } = await call('apply_plan', { id: plan.id });
  expect(JSON.parse(text)).toEqual({
    status: 'needs_approval',
    tool: 'apply_plan',
    plan_id: plan.id,
    message: `A person must approve this in Jevonganize's Review queue, or with: jevonganize apply ${plan.id}`,
  });
  expect(await readTags(path)).toEqual([]);
  expect(JSON.parse((await call('get_plan', { id: plan.id })).text)).toMatchObject({
    status: 'proposed',
  });
});

test('organize and suggest_tags have no plan yet, so the result leaves out plan_id', async () => {
  const { call } = await connect();
  const reply = JSON.parse((await call('organize', { query: {} })).text) as object;
  expect(reply).toMatchObject({ status: 'needs_approval', tool: 'organize' });
  expect(reply).not.toHaveProperty('plan_id');
  const suggested = JSON.parse((await call('suggest_tags', { id: 1 })).text) as object;
  expect(suggested).toMatchObject({ status: 'needs_approval', tool: 'suggest_tags' });
});

test('resolve_reviews and discard_plan return needs_approval and change nothing', async () => {
  const { plan } = await proposed();
  const { call } = await connect();
  const discarded = JSON.parse((await call('discard_plan', { id: plan.id })).text) as object;
  expect(discarded).toMatchObject({
    status: 'needs_approval',
    tool: 'discard_plan',
    plan_id: plan.id,
    message: expect.stringContaining('Review queue'),
  });
  expect(JSON.stringify(discarded)).not.toContain('money');
  const resolved = await call('resolve_reviews', { ids: [1], accept: false });
  expect(JSON.parse(resolved.text)).toMatchObject({
    status: 'needs_approval',
    tool: 'resolve_reviews',
  });
  expect(JSON.parse((await call('get_plan', { id: plan.id })).text)).toMatchObject({
    status: 'proposed',
  });
});

test('--allow-apply runs at once', async () => {
  const { plan, path } = await proposed();
  const { call } = await connect('--allow-apply');
  const job = JSON.parse((await call('apply_plan', { id: plan.id })).text) as { kind: string };
  expect(job.kind).toBe('apply');
  await expect.poll(() => readTags(path)).toEqual(['x']);
});

test('plans made here say mcp, reads cap their rows, and errors are tool errors', async () => {
  await proposed();
  const { call, noise } = await connect();
  const found = JSON.parse((await call('search_files')).text) as { files: { id: number }[] };
  const input = { file_ids: [found.files[0]?.id], add: ['y'], title: 'from a model' };
  const plan = JSON.parse((await call('propose_changes', input)).text) as Plan;
  expect(plan.source).toBe('mcp');
  const bad = await call('get_plan', { id: 'none' });
  expect(bad).toMatchObject({ isError: true });
  expect((await call('similar_files', { id: 'x' })).isError).toBe(true);
  expect(noise).toEqual([]); // stdout carries only MCP messages
});

test('closing stdin ends the server', async () => {
  await connect();
  const closed = new Promise((done) => {
    child?.once('close', done);
  });
  child?.stdin.end();
  expect(await closed).toBe(0);
});
