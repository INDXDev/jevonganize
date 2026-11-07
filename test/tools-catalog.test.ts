import { writeFile } from 'node:fs/promises';
import {
  Experimental_DecisionMockModelV4 as MockDecisionModel,
  MockLanguageModelV4,
} from 'ai/test';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import type * as Facets from '../src/core/facets.ts';
import { readTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import { as, at, ctx, idOf, scanned, setupToolContext } from './tools-helpers.ts';

const mock = vi.hoisted(() => ({
  names: [] as { name: string; kind: string }[],
  /** The probability of a question, from its text. */
  probability: (_text: string): number => 0.9,
  requests: [] as { questions: number; state: string }[],
  chatCalls: 0,
}));

/** A choice gives every option its own odds, as Luna does, and a boolean gives one. */
const answerQuestion = vi.hoisted(() => (question: unknown) => {
  const { type, criteria } = question as { type: string; criteria: Record<string, string> };
  if (type !== 'choice') {
    return { type: 'boolean' as const, probability: mock.probability(JSON.stringify(question)) };
  }
  const weights = Object.entries(criteria).map(
    ([id, text]) => [id, mock.probability(text)] as const,
  );
  const totalWeight = weights.reduce((sum, [, weight]) => sum + weight, 0);
  const odds = weights.map(([id, weight]) => [id, weight / totalWeight] as const);
  const [likeliest] = odds.toSorted(([, oddsA], [, oddsB]) => oddsB - oddsA);
  return {
    type: 'choice' as const,
    choice: likeliest?.[0] ?? 'other',
    probabilities: Object.fromEntries(odds),
  };
});

vi.mock('../src/core/facets.ts', async (original) => ({
  ...(await original<typeof Facets>()),
  loadCatalog: async () => [
    'finance/budgeting',
    'nature/python',
    'technology/python',
    ...Array.from({ length: 900 }, (_, index) => `science/filler-${index}`),
  ],
}));

vi.mock('../src/ai/providers.ts', async (original) => {
  const real = await original<typeof Providers>();
  const caps = real.capabilities('openai', 'gpt-6-luna');
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const chatModel = new MockLanguageModelV4({
    doGenerate: async () => {
      mock.chatCalls++;
      return {
        content: [{ type: 'text', text: JSON.stringify({ names: mock.names }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  const decisionModel = new MockDecisionModel({
    doDecide: async ({ questions, state }) => {
      mock.requests.push({
        questions: Object.keys(questions).length,
        state: JSON.stringify(state),
      });
      const answers = Object.entries(questions).map(([id, question]) => [
        id,
        answerQuestion(question),
      ]);
      return { answers: Object.fromEntries(answers), usage: { inputTokens: 10 }, warnings: [] };
    },
  });
  return {
    ...real,
    resolveChatModel: async () => ({ model: chatModel, provider: 'openai', modelId: 'm', caps }),
    resolveModel: async () => ({
      model: decisionModel,
      provider: 'openai',
      modelId: 'gpt-6-luna',
      caps,
    }),
  };
});

setupToolContext();

beforeEach(() => {
  mock.names = [];
  mock.probability = () => 0.9;
  mock.requests = [];
  mock.chatCalls = 0;
});

/** How many questions the decision model was asked, over all requests. */
const questionsAsked = () => mock.requests.reduce((total, request) => total + request.questions, 0);

/** The odds of a topic in the first test: one clear winner, then a whole branch. */
function oddsFavouringPython(text: string) {
  if (text.includes('technology/python')) return 0.99;
  if (text.includes('finance/')) return 0.8;
  return 0.1;
}

describe('pick_topics weighing', () => {
  test('weighs every topic in bounded requests, and keeps the likeliest', async () => {
    await scanned('budget-2026.xlsx', 'train.py');
    mock.probability = oddsFavouringPython;
    const picks = await callTool('pick_topics', { query: {} }, ctx);
    expect(picks.topics).toEqual([
      { value: 'technology/python', probability: 0.99 },
      { value: 'finance/budgeting', probability: 0.8 },
    ]);
    expect(picks.files).toBe(2);
    // 903 topics are 4 groups. Only the 903 with any odds at all reach a question of their own.
    expect(mock.requests[0]?.questions).toBe(4);
    expect(questionsAsked()).toBe(4 + 903);
    const requestSizes = mock.requests.map((request) => request.questions);
    expect(Math.max(...requestSizes)).toBeLessThanOrEqual(400);
    expect(picks.tokens).toBe(10 * mock.requests.length);
    expect(picks.cost_usd).toBeGreaterThan(0);
  });

  test('a topic with no odds in the sweep is never asked alone', async () => {
    await scanned('a.txt');
    mock.probability = (text) => (text.includes('filler') ? 0 : 0.9);
    const { topics } = await callTool('pick_topics', { query: {} }, ctx);
    expect(topics.map((topic) => topic.value)).toEqual([
      'finance/budgeting',
      'nature/python',
      'technology/python',
    ]);
    expect(questionsAsked()).toBe(4 + 3);
  });
});

describe('pick_topics scope', () => {
  test('sends names only, and leaves the vocabulary alone', async () => {
    await scanned('secret-name.txt');
    await callTool('pick_topics', { query: {} }, ctx);
    const { state } = mock.requests[0]!;
    expect(state).toContain('secret-name.txt');
    expect(state).not.toContain('text of');
    expect(state).not.toContain(at(''));
    expect(ctx.db.listVocabulary('topic')).toEqual([]);
  });

  test('samples a folder too long for the text budget', async () => {
    ctx.config.budget.text_chars = 40;
    await scanned(...Array.from({ length: 30 }, (_, index) => `file-${index}.txt`));
    const picks = await callTool('pick_topics', { query: {} }, ctx);
    expect(picks.files).toBeGreaterThan(0);
    expect(picks.files).toBeLessThan(10);
  });

  test('honours the limit, and offers nothing active or retired', async () => {
    await scanned('a.txt');
    ctx.db.setVocabulary('topic', 'finance/budgeting', 'retired');
    ctx.db.setVocabulary('topic', 'nature/python', 'active');
    const { topics } = await callTool('pick_topics', { query: {}, limit: 5 }, ctx);
    expect(topics).toHaveLength(5);
    const everyTopic = await callTool('pick_topics', { query: {}, limit: 1000 }, ctx);
    const values = everyTopic.topics.map((topic) => topic.value);
    expect(values).not.toContain('finance/budgeting');
    expect(values).not.toContain('nature/python');
  });

  test('refuses an empty folder, and a model without approval', async () => {
    await expect(callTool('pick_topics', { query: {} }, ctx)).rejects.toThrow('no indexed files');
    await expect(callTool('pick_topics', { query: {} }, as('mcp'))).rejects.toThrow('approve');
  });
});

test('search_catalog matches text, and a model may call it', async () => {
  expect(await callTool('search_catalog', { text: 'PYTHON' }, as('mcp'))).toEqual([
    'nature/python',
    'technology/python',
  ]);
});

/** Runs organize to its end, and returns the job with the plan it made. */
async function organized() {
  const input = { query: {}, facets: ['language'] };
  const job = await waitForJob((await callTool('organize', input, ctx)).id);
  return { job, plan: await callTool('get_plan', { id: job.plan_id ?? '' }, ctx) };
}

describe('proper names in organize', () => {
  test('tags a gated file with names it contains, on disk, and undoes', async () => {
    await writeFile(at('a.txt'), 'Contract between Acme Corp and 山田 太郎. See report.pdf.');
    await scanned('b.txt');
    mock.names = [
      { name: 'Acme Corp', kind: 'organization' },
      { name: '山田 太郎', kind: 'person' },
      { name: 'Invented Inc', kind: 'organization' },
      { name: 'a.txt', kind: 'product' },
      { name: 'report.pdf', kind: 'product' },
    ];
    const { plan } = await organized();
    expect(plan.ops.find((op) => op.file_id === idOf('a.txt'))?.add).toEqual([
      'entity:organization/acme-corp',
      'entity:person/山田-太郎',
    ]);
    const apply = await callTool('apply_plan', { id: plan.id }, ctx);
    await waitForJob(apply.id);
    expect(await readTags(at('a.txt'))).toEqual(
      expect.arrayContaining(['entity:organization/acme-corp', 'entity:person/山田-太郎']),
    );
    await waitForJob((await callTool('undo_plan', { id: plan.id }, ctx)).id);
    expect(await readTags(at('a.txt'))).toEqual([]);
  });

  test('a registered name joins the run, and is cleaned to the tag grammar', async () => {
    await scanned('a.txt');
    const value = 'organization/Acme Corp';
    await callTool('set_vocabulary', { facet: 'entity', value, state: 'active' }, ctx);
    expect(await callTool('list_vocabulary', { facet: 'entity' }, ctx)).toContainEqual(
      expect.objectContaining({ value: 'organization/acme-corp', state: 'active' }),
    );
    mock.probability = (text) => (text.includes('acme-corp') ? 0.95 : 0.1);
    const { plan } = await organized();
    expect(plan.ops[0]?.add).toContain('entity:organization/acme-corp');
  });

  test('a file the gate turns down never reaches the chat model', async () => {
    await scanned('a.txt');
    mock.probability = () => 0.1;
    mock.names = [{ name: 'text', kind: 'product' }];
    const { plan } = await organized();
    expect(mock.chatCalls).toBe(0);
    expect(plan.ops).toEqual([]);
  });

  test('a tag a person removed stays removed, and a full file still takes names', async () => {
    await scanned('a.txt');
    ctx.config.max_tags = 1;
    const held = await callTool(
      'propose_changes',
      { file_ids: [idOf('a.txt')], add: ['status:draft'], title: 'fill' },
      ctx,
    );
    await waitForJob((await callTool('apply_plan', { id: held.id }, ctx)).id);
    ctx.db.rejectTag(idOf('a.txt'), 'entity:product/text', 'no');
    mock.names = [
      { name: 'text', kind: 'product' },
      { name: 'of', kind: 'place' },
      { name: 'a.txt', kind: 'project' },
    ];
    const { plan } = await organized();
    expect(plan.ops[0]?.add).toEqual(['entity:place/of']);
    const apply = await waitForJob((await callTool('apply_plan', { id: plan.id }, ctx)).id);
    expect(apply.status).toBe('done');
    expect(await readTags(at('a.txt'))).toContain('entity:place/of');
  });
});
