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

/** What the chat model replies, and the odds the verifier gives every question. */
const mock = vi.hoisted(() => ({ generate: undefined as unknown, probability: 0.9 }));

/** A boolean answer at the mock odds for every question. Hoisted, as the provider mock uses it. */
const everyQuestionAtMockOdds = vi.hoisted(
  () => (questions: Record<string, unknown>) =>
    Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        { type: 'boolean' as const, probability: mock.probability },
      ]),
    ),
);

vi.mock('../src/ai/providers.ts', async (original) => {
  const real = await original<typeof Providers>();
  const caps = real.capabilities('openai', 'gpt-6-luna');
  const verifier = new MockDecisionModel({
    doDecide: async ({ questions }) => ({
      answers: everyQuestionAtMockOdds(questions),
      usage: { inputTokens: 1 },
      warnings: [],
    }),
  });
  return {
    ...real,
    resolveChatModel: async () => ({
      model: new MockLanguageModelV4({ doGenerate: mock.generate as never }),
      provider: 'openai',
      modelId: 'm',
      caps,
    }),
    resolveModel: async () => ({ model: verifier, provider: 'openai', modelId: 'm', caps }),
  };
});

setupToolContext();

/** The usage a chat reply reports: one token in and one out. */
const ONE_TOKEN_EACH_WAY = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A chat reply suggesting these tags. */
const suggesting = (tags: string[]) => ({
  content: [{ type: 'text', text: JSON.stringify({ tags }) }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: ONE_TOKEN_EACH_WAY,
  warnings: [],
});

/** Accepts or rejects every open review item. */
const resolveAll = (accept: boolean) => callTool('resolve_reviews', { ids: ids(), accept }, ctx);
/** Asks the chat model for tags for a.txt, and has the verifier check them. */
const suggestForA = () => callTool('suggest_tags', { id: idOf('a.txt') }, ctx);

/** The chat model will suggest these tags, and the verifier back each at these odds. */
function modelWill(suggest: string[], verifierOdds: number) {
  mock.generate = suggesting(suggest);
  mock.probability = verifierOdds;
}

describe('resolving reviews', () => {
  test('accepting builds a plan and writes nothing', async () => {
    await scanned('a.txt');
    addReview('project:acme');
    const plan = await resolveAll(true);
    expect(plan).toMatchObject({ status: 'proposed', summary: { added: { 'project:acme': 1 } } });
    expect(await readTags(at('a.txt'))).toEqual([]);
  });

  test('accepting activates open vocabulary and empties the queue', async () => {
    await scanned('a.txt');
    addReview('project:acme');
    await resolveAll(true);
    expect(ctx.db.listVocabulary('project')).toMatchObject([{ value: 'acme', state: 'active' }]);
    expect(await callTool('list_reviews', {}, ctx)).toEqual([]);
    expect(events).toContainEqual({ type: 'reviews', count: 0 });
  });

  test('rejecting returns null: a suggest stays rejected, a restore is deleted', async () => {
    await scanned('a.txt');
    addReview('topic:a');
    addReview('old', 'restore');
    expect(await resolveAll(false)).toBeNull();
    expect(ctx.db.rejectedTags(idOf('a.txt'))).toEqual(['topic:a']);
    expect(ctx.db.reviewsByIds([1, 2, 3]).map((item) => item.tag)).toEqual(['topic:a']);
  });

  test('a settled item cannot be accepted afterwards', async () => {
    await scanned('a.txt');
    addReview('topic:a');
    const [settled = 0] = ids();
    await callTool('resolve_reviews', { ids: [settled], accept: false }, ctx);
    expect(await callTool('resolve_reviews', { ids: [settled], accept: true }, ctx)).toBeNull();
  });
});

describe('set_vocabulary', () => {
  test('sets the state of a value in an open facet', async () => {
    await callTool('set_vocabulary', { facet: 'topic', value: 'tax', state: 'retired' }, ctx);
    expect(ctx.db.listVocabulary('topic')).toMatchObject([{ value: 'tax', state: 'retired' }]);
  });

  test('refuses a facet that is not open', async () => {
    const closedFacet = { facet: 'doc-type', value: 'x', state: 'active' } as const;
    await expect(callTool('set_vocabulary', closedFacet, ctx)).rejects.toThrow('not an open facet');
  });
});

describe('suggest_tags', () => {
  test('verified suggestions become review items, never tags', async () => {
    await scanned('a.txt');
    modelWill(['topic:garden', 'evil:x'], 0.9);
    const items = await suggestForA();
    expect(items).toMatchObject([{ tag: 'topic:garden', kind: 'suggest', confidence: null }]);
    expect(await readTags(at('a.txt'))).toEqual([]);
    expect(ctx.db.listVocabulary('topic')).toMatchObject([{ value: 'garden', state: 'proposed' }]);
  });

  test('the verifier drops what it does not back', async () => {
    await scanned('a.txt');
    modelWill(['topic:garden'], 0.1);
    expect(await suggestForA()).toEqual([]);
  });

  test('a rejected tag stays out, however well it is backed', async () => {
    await scanned('a.txt');
    modelWill(['topic:garden'], 0.9);
    ctx.db.rejectTag(idOf('a.txt'), 'topic:garden', 'no');
    expect(await suggestForA()).toEqual([]);
  });

  test('refuses a file now excluded', async () => {
    await scanned('a.txt');
    ctx.config.exclude.push('a.txt');
    await expect(suggestForA()).rejects.toThrow('not in a library');
  });
});
