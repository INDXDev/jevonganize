import { experimental_decide } from 'ai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openRouterModel } from '../src/ai/openrouter.ts';
import {
  capabilities,
  modelTarget,
  resolveChatModel,
  resolveModel,
  translateError,
} from '../src/ai/providers.ts';
import { configSchema, UserError } from '../src/core/config.ts';
import { getApiKey } from '../src/core/credentials.ts';
import type { ProviderName } from '../src/types.ts';

vi.mock('../src/core/credentials.ts', () => ({ getApiKey: vi.fn<typeof getApiKey>() }));
const keys = vi.mocked(getApiKey);

const config = (provider: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
  configSchema.parse({ provider, ...rest });

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  keys.mockReset();
  keys.mockResolvedValue('key');
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => void vi.unstubAllGlobals());

const lastRequest = (index = 0) => {
  const [url, init] = fetcher.mock.calls[index] ?? [];
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  return { url: typeof url === 'string' ? url : '', init, body };
};

describe('resolveModel', () => {
  test.each([
    ['openai', 'gpt-6-luna', {}],
    ['typesafe', 'jev-latest', {}],
    ['gateway', 'typesafe-ai/jev', {}],
    ['cloudflare', 'clef', { account_id: 'acct' }],
  ] as const)('%s defaults to %s', async (name, modelId, extra) => {
    const resolved = await resolveModel(config({ name, ...extra }));
    expect(resolved).toMatchObject({ provider: name, modelId });
    expect(resolved.model.modelId).toBe(modelId);
  });

  test.each([
    ['openrouter', {}],
    ['compatible', { base_url: 'http://localhost:1/v1' }],
    ['chat', { base_url: 'http://localhost:1/v1' }],
  ] as const)('%s needs a model', async (name, extra) => {
    await expect(resolveModel(config({ name, ...extra }))).rejects.toBeInstanceOf(UserError);
    const named = await resolveModel(config({ name, model: 'm', ...extra }));
    expect(named.model.modelId).toBe('m');
  });

  test.each(['openai', 'typesafe', 'gateway', 'openrouter'] as ProviderName[])(
    '%s with no key refuses, and never tries another provider',
    async (name) => {
      keys.mockImplementation(async (asked) => (asked === name ? undefined : 'other-key'));
      const run = resolveModel(config({ name, model: 'm' }));
      await expect(run).rejects.toBeInstanceOf(UserError);
      expect(keys.mock.calls).toEqual([[name]]);
    },
  );

  test('compatible and chat need base_url, and then no key', async () => {
    keys.mockResolvedValue(undefined);
    for (const name of ['compatible', 'chat']) {
      await expect(resolveModel(config({ name, model: 'm' }))).rejects.toThrow('base_url');
      const local = config({ name, model: 'm', base_url: 'http://localhost:1/v1' });
      await expect(resolveModel(local)).resolves.toMatchObject({
        provider: name,
        endpoint: 'http://localhost:1/v1',
      });
    }
  });

  test('cloudflare needs account_id', async () => {
    await expect(resolveModel(config({ name: 'cloudflare' }))).rejects.toThrow('account_id');
  });
});

describe('resolveModel profiles and targets', () => {
  test('a profile picks its own provider, and a missing one refuses', async () => {
    const withProfile = config(
      { name: 'openai' },
      { profiles: { vision: { name: 'typesafe', model: 'jev-1.14.0' } } },
    );
    await expect(resolveModel(withProfile, 'vision')).resolves.toMatchObject({
      provider: 'typesafe',
      modelId: 'jev-1.14.0',
    });
    await expect(resolveModel(withProfile, 'nope')).rejects.toThrow('nope');
  });

  test('modelTarget names the model with no key', () => {
    expect(modelTarget(config({ name: 'openai' }))).toMatchObject({ modelId: 'gpt-6-luna' });
    expect(keys).not.toHaveBeenCalled();
  });

  test('only chat models are not native', async () => {
    const local = config({ name: 'chat', model: 'm', base_url: 'http://localhost:1/v1' });
    expect((await resolveModel(local)).caps.native).toBe(false);
    expect((await resolveModel(config({ name: 'openai' }))).caps.native).toBe(true);
  });
});

const chat = (value: Record<string, unknown>) => configSchema.parse({ chat: value });

describe('resolveChatModel', () => {
  test.each(['openai', 'gateway', 'openrouter'])('%s can chat', async (name) => {
    await expect(resolveChatModel(chat({ name, model: 'm' }))).resolves.toMatchObject({
      provider: name,
    });
  });

  test('a local server needs no key', async () => {
    keys.mockResolvedValue(undefined);
    const local = chat({ name: 'chat', model: 'm', base_url: 'http://localhost:1/v1' });
    await expect(resolveChatModel(local)).resolves.toMatchObject({ provider: 'chat' });
  });

  test.each(['typesafe', 'cloudflare', 'compatible'])('%s cannot chat', async (name) => {
    await expect(resolveChatModel(chat({ name, model: 'm' }))).rejects.toBeInstanceOf(UserError);
  });

  test('no key refuses', async () => {
    keys.mockResolvedValue(undefined);
    await expect(resolveChatModel(chat({ name: 'openai' }))).rejects.toBeInstanceOf(UserError);
  });
});

test('capabilities are per model', () => {
  expect(capabilities('openai', 'gpt-6-luna')).toMatchObject({ maxQuestions: 400, maxImages: 128 });
  expect(capabilities('typesafe', 'jev-1.14.0').maxQuestions).toBe(Infinity);
  expect(capabilities('typesafe', 'jev-1.14.0').imageTypes).not.toContain('image/webp');
  expect(capabilities('cloudflare', 'clef')).toMatchObject({ maxQuestions: 64, maxImages: 0 });
  expect(capabilities('openrouter', 'cloudflare/clef-flash').maxImages).toBe(4);
  expect(capabilities('openrouter', 'microsoft/decision-1').maxImages).toBe(0);
  expect(capabilities('compatible', 'unknown').maxQuestions).toBe(64);
});

test('translateError leaves other errors alone', () => {
  const error = new Error('x');
  expect(translateError(error, 'openai')).toBe(error);
  expect(translateError({ statusCode: 403 }, 'openai')).toBeInstanceOf(UserError);
  expect(translateError(null, 'openai')).toBeNull();
});

test('cloudflare posts to the URL of the configured model and unwraps the result', async () => {
  fetcher.mockResolvedValue(
    Response.json({
      result: { answers: { a: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 5 } },
    }),
  );
  const { model } = await resolveModel(
    config({ name: 'cloudflare', model: 'clef-flash', account_id: 'acct' }),
  );
  const { answers } = await experimental_decide({
    model,
    state: 'text',
    questions: { a: { type: 'boolean', instructions: 'Q?' } },
  });
  expect(lastRequest().url).toBe(
    'https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash',
  );
  expect(answers.a.probability).toBe(0.7);
});

const model = openRouterModel('secret', 'cloudflare/clef-flash');
const questions = {
  a: { type: 'boolean', instructions: 'Q?' },
  b: { type: 'choice', instructions: 'Which?', criteria: { x: 'X.', y: null } },
  c: { type: 'score', instructions: 'How?', criteria: ['lo', 'hi'] },
} as const;

const budget = () =>
  new Response('{"error":{"metadata":{"limit_source":"openrouter_in_flight_budget"}}}', {
    status: 402,
  });
const failure = () =>
  model.doDecide({ state: [], questions: { a: questions.a }, headers: {} }).then(
    () => 'no failure',
    (error: { isRetryable: boolean; statusCode: number; requestBodyValues: unknown }) => error,
  );

const reply = {
  model: 'cloudflare/clef-flash',
  id: 'gen-1',
  answers: {
    a: { type: 'noul', noul: 0.8607 },
    b: {
      type: 'choice',
      choice: 'x',
      probabilities: { x: 0.9844, y: 0.0156 },
      confidence: 0.95,
    },
    c: { type: 'score', score: 0.75, probabilities: { 0: 0.25, 1: 0.75 }, confidence: 0.5 },
  },
  usage: { input_tokens: 289, output_tokens: 0, cost: 0.00002601 },
};

describe('openrouter', () => {
  test('sends the documented wire shape and maps answers back', async () => {
    fetcher.mockResolvedValue(Response.json(reply));
    const result = await experimental_decide({
      model,
      questions,
      state: [
        { type: 'text', text: 'guard' },
        { type: 'json', value: { name: 'a' } },
        { type: 'file', data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' },
      ],
    });
    const { url, init, body } = lastRequest();
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
    expect(body.model).toBe('cloudflare/clef-flash');
    expect(body.state).toEqual([
      'guard',
      '{"name":"a"}',
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
    ]);
    expect(body.questions.a).toEqual({
      type: 'noul',
      instructions: 'Q?',
      criteria: { true: 'True.', false: 'False.' },
    });
    expect(body.questions.b).toEqual(questions.b);
    expect(result.answers.a.probability).toBe(0.8607);
    expect(result.answers.b.choice).toBe('x');
    expect(result.answers.c.score).toBe(0.75);
    expect(result.usage.inputTokens).toBe(289);
    expect(result.providerMetadata).toEqual({ openrouter: { cost: 0.00002601 } });
  });

  test('a refusal surfaces as the SDK refusal error', async () => {
    fetcher.mockResolvedValue(Response.json({ ...reply, answers: { a: { type: 'refusal' } } }));
    await expect(
      experimental_decide({ model, state: 's', questions: { a: questions.a } }),
    ).rejects.toMatchObject({ questionIds: ['a'] });
  });
});

describe('openrouter failures', () => {
  test('an in-flight budget 402 is retried, and other 402s are not', async () => {
    fetcher.mockResolvedValueOnce(budget());
    expect(await failure()).toMatchObject({
      isRetryable: true,
      statusCode: 402,
      requestBodyValues: {},
    });
    fetcher.mockResolvedValueOnce(new Response('{"error":{"code":402}}', { status: 402 }));
    expect(await failure()).toMatchObject({ isRetryable: false });
  });

  test('401 keeps its status for translateError', async () => {
    fetcher.mockResolvedValue(new Response('{}', { status: 401 }));
    const error = await experimental_decide({
      model,
      state: 's',
      questions: { a: questions.a },
    }).catch((error_: unknown) => error_);
    expect(translateError(error, 'openrouter')).toBeInstanceOf(UserError);
  });
});
