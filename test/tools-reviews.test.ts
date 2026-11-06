import {
  Experimental_DecisionMockModelV4 as MockDecisionModel,
  MockLanguageModelV4,
} from 'ai/test';
import { describe, expect, test, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import { readTags } from '../src/core/tags.ts';
import { callTool } from '../src/core/tools.ts';
import {
  addReview,
  at,
  ctx,
  events,
  idOf,
  ids,
  scanned,
  setupToolContext,
} from './tools-helpers.ts';

const mock = vi.hoisted(() => ({ generate: undefined as unknown, probability: 0.9 }));

vi.mock('../src/ai/providers.ts', async (original) => {
  const real = await original<typeof Providers>();
  const caps = real.capabilities('openai', 'gpt-6-luna');
  return {
    ...real,
    resolveChatModel: async () => ({
      model: new MockLanguageModelV4({ doGenerate: mock.generate as never }),
      provider: 'openai',
      modelId: 'm',
      caps,
    }),
    resolveModel: async () => ({
      model: new MockDecisionModel({
        doDecide: async ({ questions }) => ({
          answers: Object.fromEntries(
            Object.keys(questions).map((id) => [
              id,
              { type: 'boolean' as const, probability: mock.probability },
            ]),
          ),
          usage: { inputTokens: 1 },
          warnings: [],
        }),
      }),
      provider: 'openai',
      modelId: 'm',
      caps,
    }),
  };
});

setupToolContext();

const reply = (tags: string[]) => ({
  content: [{ type: 'text', text: JSON.stringify({ tags }) }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
});

describe('reviews', () => {
  test('accepting builds a plan and writes nothing, and open vocabulary is activated', async () => {
    await scanned('a.txt');
    addReview('project:acme');
    const plan = await callTool('resolve_reviews', { ids: ids(), accept: true }, ctx);
    expect(plan).toMatchObject({ status: 'proposed', summary: { added: { 'project:acme': 1 } } });
    expect(await readTags(at('a.txt'))).toEqual([]);
    expect(ctx.db.listVocabulary('project')).toMatchObject([{ value: 'acme', state: 'active' }]);
    expect(await callTool('list_reviews', {}, ctx)).toEqual([]);
    expect(events).toContainEqual({ type: 'reviews', count: 0 });
  });

  test('rejecting returns null: a suggest stays rejected, a restore is deleted', async () => {
    await scanned('a.txt');
    addReview('topic:a');
    addReview('old', 'restore');
    expect(await callTool('resolve_reviews', { ids: ids(), accept: false }, ctx)).toBeNull();
    expect(ctx.db.rejectedTags(idOf('a.txt'))).toEqual(['topic:a']);
    expect(ctx.db.reviewsByIds([1, 2, 3]).map((item) => item.tag)).toEqual(['topic:a']);
  });

  test('a settled item cannot be accepted afterwards', async () => {
    await scanned('a.txt');
    addReview('topic:a');
    const [id = 0] = ids();
    await callTool('resolve_reviews', { ids: [id], accept: false }, ctx);
    expect(await callTool('resolve_reviews', { ids: [id], accept: true }, ctx)).toBeNull();
  });

  test('set_vocabulary takes open facets only', async () => {
    await callTool('set_vocabulary', { facet: 'topic', value: 'tax', state: 'retired' }, ctx);
    expect(ctx.db.listVocabulary('topic')).toMatchObject([{ value: 'tax', state: 'retired' }]);
    await expect(
      callTool('set_vocabulary', { facet: 'doc-type', value: 'x', state: 'active' }, ctx),
    ).rejects.toThrow('not an open facet');
  });
});

describe('suggest_tags', () => {
  test('verified suggestions become review items, never tags', async () => {
    await scanned('a.txt');
    mock.probability = 0.9;
    mock.generate = reply(['topic:garden', 'evil:x']);
    const items = await callTool('suggest_tags', { id: idOf('a.txt') }, ctx);
    expect(items).toMatchObject([{ tag: 'topic:garden', kind: 'suggest', confidence: null }]);
    expect(await readTags(at('a.txt'))).toEqual([]);
    expect(ctx.db.listVocabulary('topic')).toMatchObject([{ value: 'garden', state: 'proposed' }]);
  });

  test('the verifier drops what it does not back, and a rejected tag stays out', async () => {
    await scanned('a.txt');
    mock.generate = reply(['topic:garden']);
    mock.probability = 0.1;
    expect(await callTool('suggest_tags', { id: idOf('a.txt') }, ctx)).toEqual([]);
    mock.probability = 0.9;
    ctx.db.rejectTag(idOf('a.txt'), 'topic:garden', 'no');
    expect(await callTool('suggest_tags', { id: idOf('a.txt') }, ctx)).toEqual([]);
  });

  test('refuses a file now excluded', async () => {
    await scanned('a.txt');
    ctx.config.exclude.push('a.txt');
    await expect(callTool('suggest_tags', { id: idOf('a.txt') }, ctx)).rejects.toThrow(
      'not in a library',
    );
  });
});
