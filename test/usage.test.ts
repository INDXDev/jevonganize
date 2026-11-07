import type { UsageFeature } from '../src/tool-map.ts';
import { writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import { ask, chat } from '../src/ai/chat.ts';
import { writeTags } from '../src/core/tags.ts';
import { callTool, tools, waitForJob } from '../src/core/tools.ts';
import { usageRecorder } from '../src/core/usage.ts';
import { dayTotals, localDay, periodStart } from '../src/web/views/dashboard-data.ts';
import { at, ctx, idOf, scanAll, setupToolContext } from './tools-helpers.ts';
import { modelMock, resetModelMock } from './tools-model-helpers.ts';

vi.mock('../src/ai/providers.ts', async (original) =>
  (await import('./tools-model-helpers.ts')).mockedProviders(await original<typeof Providers>()),
);

setupToolContext();
beforeEach(resetModelMock);

/** The usage report's row for one feature. */
async function featureRow(feature: UsageFeature) {
  const { by_feature } = await callTool('usage_report', {}, ctx);
  return by_feature.find((row) => row.feature === feature);
}

/** Organizes every file and waits for the job. */
async function organizeAll() {
  // One flag facet, whose answers the mock gives in a shape the cache keeps.
  return waitForJob((await callTool('organize', { query: {}, facets: ['is-draft'] }, ctx)).id);
}

/** Two files carrying a tag, and one that looks like them without it. */
async function receiptLibrary() {
  const texts = {
    's1.txt': 'invoice total amount due from acme',
    's2.txt': 'invoice total amount due on payment',
    'old-receipts.txt': 'acme payment from march',
  };
  for (const [name, text] of Object.entries(texts)) await writeFile(at(name), text);
  await writeTags(at('s1.txt'), ['receipts']);
  await writeTags(at('s2.txt'), ['receipts']);
  await scanAll();
}

describe('every model call is recorded, input and output', () => {
  test('organize records one row per file, and the job adds up exactly those rows', async () => {
    await receiptLibrary();
    const job = await organizeAll();
    const rows = ctx.db.jobUsage(job.id).filter((row) => row.feature === 'organize');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ files: 1, provider: 'openai', model: 'gpt-6-luna' });
      expect(row.input_tokens).toBeGreaterThan(0);
      expect(row.output_tokens).toBeGreaterThan(0);
    }
    const all = ctx.db.jobUsage(job.id);
    const tokens = all.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
    const cost = all.reduce((sum, row) => sum + row.cost_usd!, 0);
    expect(job.tokens).toBe(tokens);
    expect(job.cost_usd).toBeCloseTo(cost, 12);
  });

  test('a second organize costs nothing, and its cached files set the hit rate', async () => {
    await receiptLibrary();
    await organizeAll();
    const again = await organizeAll();
    expect(again.tokens).toBe(0);
    expect(ctx.db.jobUsage(again.id)).toEqual([
      expect.objectContaining({ feature: 'organize-cache', files: 3, cost_usd: 0 }),
    ]);
    expect(await featureRow('organize-cache')).toMatchObject({ calls: 0, files: 3 });
    const { cache } = await callTool('library_report', {}, ctx);
    expect(cache.hit_rate_30d).toBeCloseTo(0.5);
  });

  test('refresh records one row per file checked, with the job', async () => {
    await receiptLibrary();
    await organizeAll();
    const started = await callTool('refresh_tag', { tag: 'receipts' }, ctx);
    const job = await waitForJob(started.id);
    const rows = ctx.db.jobUsage(job.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.feature === 'refresh' && row.files === 1)).toBe(true);
    expect(rows[0]).toMatchObject({ input_tokens: 10, output_tokens: 2 });
    expect(job.tokens).toBe(rows.length * 12);
  });
});

describe('suggestions and chat are recorded too', () => {
  test('suggest records the chat call and the verifier call', async () => {
    await writeFile(at('a.txt'), 'a note about budgets');
    await scanAll();
    modelMock.chatReply = { tags: ['topic:budgets'] };
    await callTool('suggest_tags', { id: idOf('a.txt') }, ctx);
    expect(await featureRow('suggest')).toMatchObject({
      calls: 2,
      files: 2,
      input_tokens: 1 + 10,
      output_tokens: 1 + 2,
    });
  });

  test('chat records each turn, streamed or whole, with no file', async () => {
    const onUsage = usageRecorder(ctx.db, 'chat');
    await ask('hi', ctx, {}, { onUsage });
    const response = await chat(
      [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      ctx,
      tools as never,
      onUsage,
    );
    await response.text();
    await vi.waitUntil(async () => (await featureRow('chat'))?.calls === 2);
    expect(await featureRow('chat')).toMatchObject({
      files: 0,
      input_tokens: 2,
      output_tokens: 2,
    });
  });
});

describe('the Dashboard', () => {
  test("the job's tokens and cost equal the Dashboard's total for today", async () => {
    await receiptLibrary();
    const job = await organizeAll();
    const now = new Date();
    const since = periodStart(1, now);
    const report = await callTool('usage_report', { since, bucket: 'day' }, ctx);
    const today = dayTotals(report, localDay(now));
    expect(today.tokens).toBe(job.tokens);
    expect(today.cost_usd).toBeCloseTo(job.cost_usd!, 12);
  });
});
