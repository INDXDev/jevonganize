/** What each provider needs, for the AI models page. Mirrors the table in `ai/providers.ts`. */
import type { ProviderName } from '../../types.ts';

/** One `[provider]`, `[chat]`, `[ner]` or `[profiles.<name>]` table, as the form edits it. */
export type ModelConfig = {
  name: ProviderName;
  model?: string;
  base_url?: string;
  account_id?: string;
};

/** The three jobs a model can do. Only `decision` ever chooses a tag. */
export type ModelRole = 'decision' | 'chat' | 'ner';

type ProviderInfo = {
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

/** The providers a role may use: chat and name reading need one that writes text. */
export function providersFor(role: ModelRole): ProviderName[] {
  const all = Object.keys(PROVIDERS) as ProviderName[];
  return role === 'decision' ? all : all.filter((name) => PROVIDERS[name].writesText);
}

/** Which of the optional fields a provider shows. A set value always shows, so it can be seen. */
export function visibleFields(value: ModelConfig): { endpoint: boolean; account: boolean } {
  const info = PROVIDERS[value.name] ?? PROVIDERS.openai;
  return {
    endpoint: info.endpoint === 'required' || !!value.base_url,
    account: info.account || !!value.account_id,
  };
}

/** A field's problem, as an English message key. */
export type Problem =
  | 'Required for this provider.'
  | 'Enter a full address that starts with http:// or https://.'
  | 'This provider only decides tags, so it cannot do this job.';

/** Problems by field, for inline messages. Empty when the table can be saved and used. */
export function modelProblems(
  value: ModelConfig,
  role: ModelRole,
): Partial<Record<keyof ModelConfig, Problem>> {
  const info = PROVIDERS[value.name];
  if (!info) return {};
  const problems: Partial<Record<keyof ModelConfig, Problem>> = {};
  if (role !== 'decision' && !info.writesText)
    problems.name = 'This provider only decides tags, so it cannot do this job.';
  if (!info.defaultModel && !value.model?.trim()) problems.model = 'Required for this provider.';
  if (value.base_url) {
    if (!isHttpUrl(value.base_url))
      problems.base_url = 'Enter a full address that starts with http:// or https://.';
  } else if (info.endpoint === 'required') problems.base_url = 'Required for this provider.';
  if (info.account && !value.account_id?.trim())
    problems.account_id = 'Required for this provider.';
  return problems;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const FIELDS = ['name', 'model', 'base_url', 'account_id'] as const;

/** Only the four keys a model table holds, so a copy carries nothing else. */
export function modelOf(value: unknown): ModelConfig {
  const table = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const picked: Record<string, string> = {};
  for (const key of FIELDS) if (typeof table[key] === 'string') picked[key] = table[key];
  return { name: 'openai', ...picked };
}

/** True when two model tables would reach the same model at the same place. */
export function sameModel(a: ModelConfig, b: ModelConfig): boolean {
  // A key the provider ignores, such as a stale `account_id`, changes nothing.
  const resolved = (m: ModelConfig) => ({
    name: m.name,
    model: m.model || PROVIDERS[m.name]?.defaultModel || '',
    base_url: PROVIDERS[m.name]?.endpoint === 'none' ? '' : (m.base_url ?? ''),
    account_id: PROVIDERS[m.name]?.account ? (m.account_id ?? '') : '',
  });
  return JSON.stringify(resolved(a)) === JSON.stringify(resolved(b));
}

/** Whether a role can follow the decision model, which needs a provider that writes text. */
export const canFollow = (decision: ModelConfig) => PROVIDERS[decision.name].writesText;
