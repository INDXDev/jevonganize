import { expect, test } from 'vitest';
import { estimateCost } from '../src/ai/pricing.ts';

const million = 1_000_000;

test.each([
  ['openai', 'gpt-6-luna', 0.1],
  ['typesafe', 'jev-1.14.0', 0.042],
  ['gateway', 'typesafe-ai/jev', 0.042],
  ['openrouter', 'typesafe-ai/jev-1.14.0', 0.042],
  ['cloudflare', 'clef', 0.24],
  ['cloudflare', 'clef-flash', 0.038],
] as const)('%s %s', (provider, modelId, price) => {
  expect(estimateCost(million, { provider, modelId })).toBeCloseTo(price);
});

test.each([
  ['compatible', 'jev-latest'],
  ['chat', 'llama'],
  ['openai', 'gpt-5'],
] as const)('%s %s has no known price', (provider, modelId) => {
  expect(estimateCost(million, { provider, modelId })).toBeNull();
});
