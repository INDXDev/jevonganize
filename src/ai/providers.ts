/** The provider table. A job uses the configured provider or none: there is no fallback. */
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Experimental_DecisionLanguageModel as DecisionLanguageModel } from '@ai-sdk/provider-utils/experimental-decision';
import { createTypeSafeAi, type TypeSafeAiProvider } from '@ai-sdk/typesafe-ai';
import { type LanguageModel, RetryError } from 'ai';
import { type Config, isTable, UserError } from '../core/config.ts';
import { getApiKey } from '../core/credentials.ts';
import type { ProviderName } from '../types.ts';
import { openRouterModel } from './openrouter.ts';

type DecisionModel = ReturnType<TypeSafeAiProvider['decisionModel']>;
type ProviderConfig = Config['provider'];
type Build<T> = (key: string | undefined, modelId: string, provider: ProviderConfig) => T;

/** What a model accepts per request. See docs/providers.md#limits. */
export interface Capabilities {
  maxQuestions: number;
  maxImages: number;
  imageTypes: string[];
  /** False when a chat model estimates answers through the SDK's wrapper. */
  native: boolean;
}

/** The names that identify a model, which need no API key. */
export interface ModelTarget {
  provider: ProviderName;
  modelId: string;
  /** A custom endpoint, whose same-named model may be a different one. */
  endpoint?: string;
  caps: Capabilities;
}

/** A ready decision model. */
export interface ResolvedModel extends ModelTarget {
  model: DecisionModel;
}

/** A ready text-generating model, for the chat panel and tag suggestions. */
export interface ResolvedChatModel extends ModelTarget {
  model: LanguageModel;
}

const PNG_JPEG = ['image/png', 'image/jpeg'];
const JEV: Capabilities = {
  maxQuestions: Infinity,
  maxImages: Infinity,
  imageTypes: PNG_JPEG,
  native: true,
};
const LUNA: Capabilities = {
  maxQuestions: 400,
  maxImages: 128,
  imageTypes: [...PNG_JPEG, 'image/webp', 'image/gif'],
  native: true,
};
const CLEF: Capabilities = {
  maxQuestions: 64,
  maxImages: 4,
  imageTypes: [...PNG_JPEG, 'image/webp'],
  native: true,
};
/** For models with no published limits. */
const CAUTIOUS: Capabilities = { ...CLEF, imageTypes: PNG_JPEG };

/** Limits by provider and model. Unknown models get the strictest published limits. */
export function capabilities(provider: ProviderName, modelId: string): Capabilities {
  if (provider === 'chat') return { ...CAUTIOUS, native: false };
  // The TypeSafe client uploads images in a form Clef's Workers AI schema rejects.
  if (provider === 'cloudflare') return { ...CLEF, maxImages: 0 };
  if (modelId.includes('jev')) return JEV;
  if (modelId.includes('luna')) return LUNA;
  if (modelId.includes('clef')) return CLEF;
  if (modelId.toLowerCase().includes('microsoft')) return { ...CAUTIOUS, maxImages: 0 };
  return CAUTIOUS;
}

/** Workers AI speaks the Jev protocol at a per-model URL, and wraps responses in `{ result }`. */
function cloudflareFetch(accountId: string, modelId: string): typeof fetch {
  const account = encodeURIComponent(accountId);
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${encodeURIComponent(modelId)}`;
  return async (_input, init) => {
    const response = await fetch(url, init);
    if (!response.ok) return response;
    const body: unknown = await response.json();
    return Response.json(isTable(body) ? body.result : body);
  };
}

const compatibleChat = (name: string, baseURL: string, apiKey: string | undefined) =>
  createOpenAICompatible({ name, baseURL, apiKey, supportsStructuredOutputs: true });

const typesafe: Build<DecisionModel> = (key, modelId, { base_url }) =>
  // A placeholder, or the client would pick up TYPESAFE_AI_API_KEY and send it to `base_url`.
  createTypeSafeAi({ apiKey: key ?? 'none', baseURL: base_url }).decisionModel(modelId);

const PROVIDERS: Record<
  ProviderName,
  {
    defaultModel?: string;
    /** Needs `base_url`, and then a key is optional, since a local server may want none. */
    endpoint?: boolean;
    decision: Build<DecisionModel>;
    /** Absent for providers that only serve decisions. */
    language?: Build<LanguageModel>;
  }
> = {
  openai: {
    defaultModel: 'gpt-6-luna',
    decision: (apiKey, modelId, { base_url }) =>
      createOpenAI({ apiKey, baseURL: base_url }).decisionModel(modelId),
    language: (apiKey, modelId, { base_url }) =>
      createOpenAI({ apiKey, baseURL: base_url }).languageModel(modelId),
  },
  typesafe: { defaultModel: 'jev-latest', decision: typesafe },
  gateway: {
    defaultModel: 'typesafe-ai/jev',
    decision: (apiKey, modelId, { base_url }) =>
      createGateway({ apiKey, baseURL: base_url }).decisionModel(modelId),
    language: (apiKey, modelId, { base_url }) =>
      createGateway({ apiKey, baseURL: base_url }).languageModel(modelId),
  },
  cloudflare: {
    defaultModel: 'clef',
    decision: (apiKey, modelId, { account_id }) => {
      if (!account_id) throw new UserError('Provider "cloudflare" needs account_id.');
      const fetch = cloudflareFetch(account_id, modelId);
      return createTypeSafeAi({ apiKey, fetch }).decisionModel(modelId);
    },
  },
  openrouter: {
    decision: (key, modelId, { base_url }) => openRouterModel(key ?? '', modelId, base_url),
    language: (key, modelId) =>
      compatibleChat('openrouter', 'https://openrouter.ai/api/v1', key).chatModel(modelId),
  },
  compatible: { endpoint: true, decision: typesafe },
  chat: {
    endpoint: true,
    decision: (key, modelId, { base_url }) =>
      new DecisionLanguageModel({
        model: compatibleChat('chat', base_url ?? '', key).chatModel(modelId),
        provider: 'chat',
      }),
    language: (key, modelId, { base_url }) =>
      compatibleChat('chat', base_url ?? '', key).chatModel(modelId),
  },
};

function toTarget(provider: ProviderConfig): ModelTarget {
  const { name, base_url: endpoint } = provider;
  const modelId = provider.model ?? PROVIDERS[name].defaultModel;
  if (!modelId) throw new UserError(`Provider "${name}" needs a model.`);
  if (PROVIDERS[name].endpoint && !endpoint)
    throw new UserError(`Provider "${name}" needs base_url.`);
  return { provider: name, modelId, endpoint, caps: capabilities(name, modelId) };
}

function configured(config: Config, profile?: string): ProviderConfig {
  if (profile === undefined) return config.provider;
  const named = config.profiles[profile];
  if (!named) throw new UserError(`There is no profile named "${profile}".`);
  return named;
}

async function keyFor({ name }: ProviderConfig): Promise<string | undefined> {
  const key = await getApiKey(name);
  if (!key && !PROVIDERS[name].endpoint) {
    throw new UserError(`There is no API key for provider "${name}", so nothing was sent.`);
  }
  return key;
}

/** Names the model a run would use, with no key needed, for estimates and cache lookups. */
export function modelTarget(config: Config, profile?: string): ModelTarget {
  return toTarget(configured(config, profile));
}

/** Builds the configured decision model, or throws a `UserError`. Never picks another provider. */
export async function resolveModel(config: Config, profile?: string): Promise<ResolvedModel> {
  const provider = configured(config, profile);
  const target = toTarget(provider);
  const model = PROVIDERS[provider.name].decision(await keyFor(provider), target.modelId, provider);
  return { ...target, model };
}

/** Builds the `[chat]` model, or the `[ner]` one, which must generate text. */
export async function resolveChatModel(
  config: Config,
  section: 'chat' | 'ner' = 'chat',
): Promise<ResolvedChatModel> {
  const provider = config[section];
  const build = PROVIDERS[provider.name].language;
  if (!build) throw new UserError(`Provider "${provider.name}" cannot be used for [${section}].`);
  const target = toTarget(provider);
  return { ...target, model: build(await keyFor(provider), target.modelId, provider) };
}

/** A rejected key fails every file the same way, so it becomes a `UserError` that stops the job. */
export function translateError(error: unknown, provider: ProviderName): unknown {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  const status = isTable(cause) ? cause.statusCode : undefined;
  if (status !== 401 && status !== 403) return error;
  return new UserError(`Provider "${provider}" rejected the API key (HTTP ${String(status)}).`);
}
