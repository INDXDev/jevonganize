/** The model tables the AI models page edits: what each role may use, and what is missing. */
import type { ProviderName } from '../../types.ts';
import type { Config } from './settings-form.tsx';
import { PROVIDERS, type ProviderInfo } from './settings-providers.ts';

/** One `[provider]`, `[chat]`, `[ner]` or `[profiles.<name>]` table, as the form edits it. */
export type ModelConfig = {
  name: ProviderName;
  model?: string;
  base_url?: string;
  account_id?: string;
};

/** The three jobs a model can do. Only `decision` ever chooses a tag. */
export type ModelRole = 'decision' | 'chat' | 'ner';

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
export type ModelProblem =
  | 'Required for this provider.'
  | 'Enter a full address that starts with http:// or https://.'
  | 'This provider only decides tags, so it cannot do this job.';

/** The server address's problem: a set address must be http(s), and some providers need one. */
function baseUrlProblem(baseUrl: string | undefined, info: ProviderInfo): ModelProblem | undefined {
  if (baseUrl) {
    return isHttpUrl(baseUrl)
      ? undefined
      : 'Enter a full address that starts with http:// or https://.';
  }
  return info.endpoint === 'required' ? 'Required for this provider.' : undefined;
}

/** Problems by field, for inline messages. Empty when the table can be saved and used. */
export function modelProblems(
  value: ModelConfig,
  role: ModelRole,
): Partial<Record<keyof ModelConfig, ModelProblem>> {
  const info = PROVIDERS[value.name];
  if (!info) return {};
  const problems: Partial<Record<keyof ModelConfig, ModelProblem>> = {};
  const helperCannotWrite = role !== 'decision' && !info.writesText;
  if (helperCannotWrite)
    problems.name = 'This provider only decides tags, so it cannot do this job.';
  const missingModel = !info.defaultModel && !value.model?.trim();
  if (missingModel) problems.model = 'Required for this provider.';
  const addressProblem = baseUrlProblem(value.base_url, info);
  if (addressProblem) problems.base_url = addressProblem;
  const missingAccount = info.account && !value.account_id?.trim();
  if (missingAccount) problems.account_id = 'Required for this provider.';
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

const MODEL_KEYS = ['name', 'model', 'base_url', 'account_id'] as const;

/** Only the four keys a model table holds, so a copy carries nothing else. */
export function modelOf(value: unknown): ModelConfig {
  const table = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const stringKeys: Record<string, string> = {};
  for (const key of MODEL_KEYS) if (typeof table[key] === 'string') stringKeys[key] = table[key];
  return { name: 'openai', ...stringKeys };
}

/**
 * The model a table actually reaches, with defaults filled in. A key the provider ignores, such as
 * a stale `account_id`, is blanked, so it changes nothing.
 */
function effectiveModel(model: ModelConfig) {
  const info = PROVIDERS[model.name];
  return {
    name: model.name,
    model: model.model || info?.defaultModel || '',
    base_url: info?.endpoint === 'none' ? '' : (model.base_url ?? ''),
    account_id: info?.account ? (model.account_id ?? '') : '',
  };
}

/** True when two model tables would reach the same model at the same place. */
export function sameModel(a: ModelConfig, b: ModelConfig): boolean {
  return JSON.stringify(effectiveModel(a)) === JSON.stringify(effectiveModel(b));
}

/** Whether a role can follow the decision model, which needs a provider that writes text. */
export const canFollow = (decision: ModelConfig) => PROVIDERS[decision.name].writesText;

/** The `[profiles]` table of a config, empty when it has none. */
export const profileTables = (draft: Config) => (draft.profiles ?? {}) as Record<string, unknown>;

/** How many problems one model table has, for the role it plays. */
const problemCount = ([table, role]: [unknown, ModelRole]) =>
  Object.keys(modelProblems(modelOf(table), role)).length;

/** Problems that keep the AI models page from saving, as a count. */
export function countModelProblems(draft: Config): number {
  const profileEntries = Object.values(profileTables(draft)).map(
    (profile) => [profile, 'decision'] as [unknown, ModelRole],
  );
  const tables: [unknown, ModelRole][] = [
    [draft.provider, 'decision'],
    [draft.chat, 'chat'],
    [draft.ner, 'ner'],
    ...profileEntries,
  ];
  return tables
    .filter(([table]) => table !== undefined)
    .reduce((total, entry) => total + problemCount(entry), 0);
}
