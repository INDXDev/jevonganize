/** Rough USD costs. Decision models bill input only. */
import type { ProviderName } from '../types.ts';
import type { ModelTarget } from './providers.ts';

const PER_PRICE = 1_000_000;
const JEV = 0.042;

// USD per million input tokens, checked 2026-11-06. First match wins. Keep with docs/providers.md.
// shortcut: Luna's cache and over-272k rates are left out, add them if real bills disagree.
const INPUT_PRICES: Partial<Record<ProviderName, [RegExp, number][]>> = {
  openai: [[/^gpt-6-luna/, 0.1]],
  typesafe: [[/^jev/, JEV]],
  gateway: [[/^typesafe-ai\/jev/, JEV]],
  openrouter: [[/(^|\/)jev/, JEV]],
  cloudflare: [
    [/^clef-flash/, 0.038],
    [/^clef/, 0.24],
  ],
};

/** What input tokens cost, or null when the price is unknown. */
export function estimateCost(
  tokens: number,
  { provider, modelId }: Pick<ModelTarget, 'provider' | 'modelId'>,
): number | null {
  const price = INPUT_PRICES[provider]?.find(([model]) => model.test(modelId))?.[1];
  return price === undefined ? null : (tokens * price) / PER_PRICE;
}
