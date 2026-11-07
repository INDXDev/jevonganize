/** Rough USD costs of a model call, input and output. */
import type { ProviderName } from '../types.ts';
import type { ModelTarget } from './providers.ts';

const PER_PRICE = 1_000_000;
const JEV = 0.042;

/** Prices of a provider's models: the first pattern that matches the model id wins. */
type PriceTable = Partial<Record<ProviderName, [RegExp, number][]>>;

/** The tokens one model call billed, each way. */
export interface TokenUsage {
  input: number;
  output: number;
}

/** The model a call went to, as far as its price needs. */
export type PricedModel = Pick<ModelTarget, 'provider' | 'modelId'>;

// USD per million input tokens, checked 2026-11-06. First match wins. Keep with docs/providers.md.
// shortcut: Luna's cache and over-272k rates are left out, add them if real bills disagree.
const INPUT_PRICES: PriceTable = {
  openai: [[/^gpt-6-luna/, 0.1]],
  typesafe: [[/^jev/, JEV]],
  gateway: [[/^typesafe-ai\/jev/, JEV]],
  openrouter: [[/(^|\/)jev/, JEV]],
  cloudflare: [
    [/^clef-flash/, 0.038],
    [/^clef/, 0.24],
  ],
};

// USD per million output tokens, checked 2026-11-07. Keep with docs/providers.md. Decision calls
// bill input only, so every model here is 0. shortcut: `gpt-6-luna` as the `[chat]` model bills
// its output at a rate not checked yet, so chat costs on it run low; add the rate when known.
const OUTPUT_PRICES: PriceTable = {
  openai: [[/^gpt-6-luna/, 0]],
  typesafe: [[/^jev/, 0]],
  gateway: [[/^typesafe-ai\/jev/, 0]],
  openrouter: [[/(^|\/)jev/, 0]],
  cloudflare: [[/^clef/, 0]],
};

/** Hears each billed model call, so the caller can record it. `ai/` itself stores nothing. */
export type OnUsage = (model: PricedModel, tokens: TokenUsage) => void;

/** The SDK's usage of a chat call, with a missing count as 0. */
export const toTokenUsage = (usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}): TokenUsage => ({
  input: usage.inputTokens ?? 0,
  output: usage.outputTokens ?? 0,
});

/** Both price tables, input and output. */
export interface Prices {
  input: PriceTable;
  output: PriceTable;
}

const BUILT_IN: Prices = { input: INPUT_PRICES, output: OUTPUT_PRICES };

const priceIn = (table: PriceTable, { provider, modelId }: PricedModel) =>
  table[provider]?.find(([model]) => model.test(modelId))?.[1];

/**
 * What a call's tokens cost, input and output together, or null when either price is unknown. An
 * estimate before a run passes `output: 0`, as only the input can be known then.
 */
export function estimateCost(
  tokens: TokenUsage,
  model: PricedModel,
  prices: Prices = BUILT_IN,
): number | null {
  const input = priceIn(prices.input, model);
  const output = priceIn(prices.output, model);
  if (input === undefined || output === undefined) return null;
  return (tokens.input * input + tokens.output * output) / PER_PRICE;
}
