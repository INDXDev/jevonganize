/** What each provider needs, for the AI models page. Mirrors the table in `ai/providers.ts`. */
import type { ProviderName } from '../../types.ts';

/** One provider's label, defaults and the fields it uses. */
export type ProviderInfo = {
  label: string;
  /** Used when `model` is empty. Absent means the model must be set. */
  defaultModel?: string;
  /** `required` providers have no address of their own. `optional` ones accept an override. */
  endpoint: 'required' | 'optional' | 'none';
  account: boolean;
  /** Whether it can write text, which `[chat]` and `[ner]` need. */
  writesText: boolean;
  /** Shown as the endpoint placeholder. */
  endpointExample?: string;
  modelExample?: string;
};

/** By provider, in the order of the select. See docs/providers.md. */
export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-6-luna',
    endpoint: 'optional',
    account: false,
    writesText: true,
  },
  typesafe: {
    label: 'TypeSafe AI (Jev)',
    defaultModel: 'jev-latest',
    endpoint: 'optional',
    account: false,
    writesText: false,
  },
  gateway: {
    label: 'Vercel AI Gateway',
    defaultModel: 'typesafe-ai/jev',
    endpoint: 'optional',
    account: false,
    writesText: true,
  },
  cloudflare: {
    label: 'Cloudflare Workers AI',
    defaultModel: 'clef',
    endpoint: 'none',
    account: true,
    writesText: false,
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'optional',
    account: false,
    writesText: true,
    modelExample: 'typesafe-ai/jev',
  },
  compatible: {
    label: 'Jev-compatible server',
    endpoint: 'required',
    account: false,
    writesText: false,
    endpointExample: 'http://localhost:8080/v1',
    modelExample: 'jev-1.14.0',
  },
  chat: {
    label: 'OpenAI-compatible chat server',
    endpoint: 'required',
    account: false,
    writesText: true,
    endpointExample: 'http://localhost:11434/v1',
    modelExample: 'llama3.1',
  },
};
