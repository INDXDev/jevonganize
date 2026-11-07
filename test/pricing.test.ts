import { expect, test } from 'vitest';
import { estimateCost, toTokenUsage } from '../src/ai/pricing.ts';

const million = 1_000_000;
const inputOnly = { input: million, output: 0 };

test.each([
  ['openai', 'gpt-6-luna', 0.1],
  ['typesafe', 'jev-1.14.0', 0.042],
  ['gateway', 'typesafe-ai/jev', 0.042],
  ['openrouter', 'typesafe-ai/jev-1.14.0', 0.042],
  ['cloudflare', 'clef', 0.24],
  ['cloudflare', 'clef-flash', 0.038],
] as const)('%s %s', (provider, modelId, price) => {
  expect(estimateCost(inputOnly, { provider, modelId })).toBeCloseTo(price);
});

test.each([
  ['compatible', 'jev-latest'],
  ['chat', 'llama'],
  ['openai', 'gpt-5'],
] as const)('%s %s has no known price', (provider, modelId) => {
  expect(estimateCost(inputOnly, { provider, modelId })).toBeNull();
  expect(estimateCost({ input: 0, output: million }, { provider, modelId })).toBeNull();
});

test('decision models bill input only, so their output adds nothing', () => {
  const model = { provider: 'typesafe', modelId: 'jev' } as const;
  const withOutput = estimateCost({ input: million, output: million }, model);
  expect(withOutput).toBeCloseTo(estimateCost(inputOnly, model)!);
});

test('the input and output prices are added together', () => {
  const prices = { input: { openai: [[/^m/, 2]] }, output: { openai: [[/^m/, 8]] } } as const;
  const model = { provider: 'openai', modelId: 'm' } as const;
  const tables = prices as unknown as Parameters<typeof estimateCost>[2];
  expect(estimateCost({ input: million, output: million / 2 }, model, tables)).toBeCloseTo(6);
});

test('a model priced for input but not output has an unknown cost', () => {
  const prices = { input: { openai: [[/^m/, 2]] }, output: {} } as const;
  const tables = prices as unknown as Parameters<typeof estimateCost>[2];
  expect(estimateCost(inputOnly, { provider: 'openai', modelId: 'm' }, tables)).toBeNull();
});

test('a chat call with no usage reported counts as nothing', () => {
  expect(toTokenUsage({})).toEqual({ input: 0, output: 0 });
  expect(toTokenUsage({ inputTokens: 3, outputTokens: 4 })).toEqual({ input: 3, output: 4 });
});
