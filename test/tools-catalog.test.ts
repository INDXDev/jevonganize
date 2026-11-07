import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import type * as Facets from '../src/core/facets.ts';
import { callTool } from '../src/core/tools.ts';
import { as, at, ctx, scanned, setupToolContext } from './tools-helpers.ts';
import {
  CATALOG_TOPICS,
  modelMock,
  questionsAsked,
  resetModelMock,
} from './tools-model-helpers.ts';

// The factories run before this file's imports settle, so they load the helpers themselves.
vi.mock('../src/core/facets.ts', async (original) => ({
  ...(await original<typeof Facets>()),
  loadCatalog: async () => (await import('./tools-model-helpers.ts')).CATALOG_TOPICS,
}));
vi.mock('../src/ai/providers.ts', async (original) =>
  (await import('./tools-model-helpers.ts')).mockedProviders(await original<typeof Providers>()),
);

setupToolContext();
beforeEach(resetModelMock);

/** The first sweep asks one question per group of topics, and 903 topics make four groups. */
const SWEEP_QUESTIONS = 4;

const pickTopics = (limit?: number) => callTool('pick_topics', { query: {}, limit }, ctx);

/** One clear winner, then a whole branch, and little for the rest. */
function oddsFavouringPython(text: string) {
  if (text.includes('technology/python')) return 0.99;
  if (text.includes('finance/')) return 0.8;
  return 0.1;
}

describe('pick_topics weighing', () => {
  test('keeps the likeliest topics, from every scanned file', async () => {
    await scanned('budget-2026.xlsx', 'train.py');
    modelMock.oddsOf = oddsFavouringPython;
    const picks = await pickTopics();
    expect(picks.topics).toEqual([
      { value: 'technology/python', probability: 0.99 },
      { value: 'finance/budgeting', probability: 0.8 },
    ]);
    expect(picks.files).toBe(2);
  });

  test('asks each topic with any odds on its own, in bounded requests', async () => {
    await scanned('budget-2026.xlsx', 'train.py');
    modelMock.oddsOf = oddsFavouringPython;
    await pickTopics();
    expect(modelMock.decisionRequests[0]?.questionCount).toBe(SWEEP_QUESTIONS);
    expect(questionsAsked()).toBe(SWEEP_QUESTIONS + CATALOG_TOPICS.length);
    const requestSizes = modelMock.decisionRequests.map((request) => request.questionCount);
    expect(Math.max(...requestSizes)).toBeLessThanOrEqual(400);
  });

  test('reports the tokens and the cost of every request', async () => {
    await scanned('budget-2026.xlsx', 'train.py');
    modelMock.oddsOf = oddsFavouringPython;
    const picks = await pickTopics();
    const tokensPerRequest = 10 + 2;
    const requests = modelMock.decisionRequests.length;
    expect(picks.tokens).toBe(tokensPerRequest * requests);
    expect(picks.cost_usd).toBeGreaterThan(0);
    const { by_feature } = await callTool('usage_report', {}, ctx);
    expect(by_feature).toEqual([
      expect.objectContaining({ feature: 'topics', calls: requests, input_tokens: 10 * requests }),
    ]);
  });

  test('a topic with no odds in the sweep is never asked alone', async () => {
    await scanned('a.txt');
    modelMock.oddsOf = (text) => (text.includes('filler') ? 0 : 0.9);
    const { topics } = await pickTopics();
    const namedTopics = ['finance/budgeting', 'nature/python', 'technology/python'];
    expect(topics.map((topic) => topic.value)).toEqual(namedTopics);
    expect(questionsAsked()).toBe(SWEEP_QUESTIONS + namedTopics.length);
  });
});

describe('pick_topics scope', () => {
  test('sends names only, and leaves the vocabulary alone', async () => {
    await scanned('secret-name.txt');
    await pickTopics();
    const sentState = modelMock.decisionRequests[0]!.stateJson;
    expect(sentState).toContain('secret-name.txt');
    expect(sentState).not.toContain('text of');
    expect(sentState).not.toContain(at(''));
    expect(ctx.db.listVocabulary('topic')).toEqual([]);
  });

  test('samples a folder too long for the text budget', async () => {
    ctx.config.budget.text_chars = 40;
    await scanned(...Array.from({ length: 30 }, (_, index) => `file-${index}.txt`));
    const picks = await pickTopics();
    expect(picks.files).toBeGreaterThan(0);
    expect(picks.files).toBeLessThan(10);
  });

  test('honours the limit', async () => {
    await scanned('a.txt');
    expect((await pickTopics(5)).topics).toHaveLength(5);
  });

  test('offers nothing already active or retired', async () => {
    await scanned('a.txt');
    ctx.db.setVocabulary('topic', 'finance/budgeting', 'retired');
    ctx.db.setVocabulary('topic', 'nature/python', 'active');
    const offered = (await pickTopics(1000)).topics.map((topic) => topic.value);
    expect(offered).not.toContain('finance/budgeting');
    expect(offered).not.toContain('nature/python');
  });

  test('refuses an empty folder, and a model without approval', async () => {
    await expect(pickTopics()).rejects.toThrow('no indexed files');
    await expect(callTool('pick_topics', { query: {} }, as('mcp'))).rejects.toThrow('approve');
  });
});

test('search_catalog matches text, and a model may call it', async () => {
  const matches = await callTool('search_catalog', { text: 'PYTHON' }, as('mcp'));
  expect(matches).toEqual(['nature/python', 'technology/python']);
});
