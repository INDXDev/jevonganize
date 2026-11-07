import { t } from '../i18n/index.ts';
import { Check, KeyRound } from 'lucide-react';
import type { ProviderName } from '../../types.ts';
import { Button } from '../components/ui/button.tsx';
import { Field, Input, Select } from '../components/ui/field.tsx';
import { setView } from '../tabs.ts';
import {
  modelProblems,
  providersFor,
  visibleFields,
  type ModelConfig,
  type ModelRole,
  type ModelProblem,
} from './settings-models.ts';
import { PROVIDERS } from './settings-providers.ts';

const BLURBS = {
  openai: 'Recommended. Needs an OpenAI API key, and accepts images.',
  typesafe: 'Direct access to Jev. It decides tags only, and cannot chat.',
  gateway: 'Vercel AI Gateway, which reaches several models with one key.',
  cloudflare: 'Workers AI. Needs your account ID. Text only, and it decides tags only.',
  openrouter: 'OpenRouter. Set the model id. Its decision endpoint is still in alpha.',
  compatible: 'Your own server that speaks the Jev protocol. A key is optional.',
  chat: 'Any OpenAI-compatible chat server, such as Ollama or Groq. Its answers are estimates, so they wait in Review.',
} as const satisfies Record<ProviderName, string>;

const KEY_SOURCE = {
  file: 'Key stored on this machine.',
  env: 'Key taken from the environment.',
} as const;

/** Where each provider's key comes from, as `list_keys` reports it. */
export type Keys = { provider: ProviderName; source: 'env' | 'file' | null }[];

/** Turns an emptied input into `undefined`, so the key drops out of the config. */
const orUnset = (typed: string) => typed || undefined;

function ProblemText({ text }: { text?: string }) {
  if (!text) return null;
  return <span className="mt-0.5 block text-xs text-destructive">{text}</span>;
}

/** The help line under a field, followed by its problem when it has one. */
function Help({ text, problem }: { text: string; problem?: ModelProblem }) {
  return (
    <>
      {text}
      <ProblemText text={problem && t(problem)} />
    </>
  );
}

function keyStatusText(source: Keys[number]['source'], isLocal: boolean) {
  if (source) return t(KEY_SOURCE[source]);
  if (isLocal) return t('No key. A local server may not need one.');
  return t('No key yet. Without one, nothing is sent.');
}

/** Whether `name` has a key, and the way to add one when it has not. */
export function KeyStatus({ name, keys }: { name: ProviderName; keys: Keys }) {
  const source = keys.find((entry) => entry.provider === name)?.source ?? null;
  // A server of your own often runs without a key, so a missing one is not a warning there.
  const isLocal = PROVIDERS[name].endpoint === 'required';
  const isReady = source !== null || isLocal;
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      {isReady ? (
        <Check aria-hidden className="size-3.5 shrink-0 text-ok" />
      ) : (
        <KeyRound aria-hidden className="size-3.5 shrink-0 text-warn" />
      )}
      <span className="min-w-0 flex-1 text-muted-foreground">{keyStatusText(source, isLocal)}</span>
      {!source && (
        <Button variant="ghost" onClick={() => setView({ section: 'keys' })}>
          {t('Add a key')}
        </Button>
      )}
    </div>
  );
}

type FieldProps = {
  value: ModelConfig;
  problems: ReturnType<typeof modelProblems>;
  set: (patch: Partial<ModelConfig>) => void;
};

function ServiceField({ value, problems, set, modelRole }: FieldProps & { modelRole: ModelRole }) {
  // The current service stays listed even when this role would not offer it.
  const names = [...new Set([...providersFor(modelRole), value.name])];
  const options = names.map((name) => ({ value: name, label: PROVIDERS[name].label }));
  return (
    <Field
      label={t('AI service')}
      help={<Help text={t(BLURBS[value.name])} problem={problems.name} />}
    >
      <Select
        label={t('AI service')}
        className="w-72"
        value={value.name}
        options={options}
        onChange={(name) => set({ name: name as ProviderName })}
      />
    </Field>
  );
}

function ModelIdField({ value, problems, set }: FieldProps) {
  const info = PROVIDERS[value.name];
  const help = info.defaultModel
    ? t('Leave empty to use {model}.', { model: info.defaultModel })
    : t('The model id, such as {example}.', { example: info.modelExample ?? '' });
  return (
    <Field label={t('Model')} help={<Help text={help} problem={problems.model} />}>
      <Input
        className="max-w-80 font-mono"
        aria-invalid={!!problems.model}
        placeholder={info.defaultModel ?? info.modelExample}
        value={value.model ?? ''}
        onChange={(e) => set({ model: orUnset(e.target.value) })}
      />
    </Field>
  );
}

function EndpointField({ value, problems, set }: FieldProps) {
  const info = PROVIDERS[value.name];
  const help =
    info.endpoint === 'required'
      ? t('The address of your server, such as {example}.', {
          example: info.endpointExample ?? '',
        })
      : t("Requests go here instead of the service's own address. To remove it, edit config.toml.");
  return (
    <Field label={t('Server address')} help={<Help text={help} problem={problems.base_url} />}>
      <Input
        className="max-w-96 font-mono"
        inputMode="url"
        aria-invalid={!!problems.base_url}
        placeholder={info.endpointExample}
        value={value.base_url ?? ''}
        onChange={(e) => set({ base_url: orUnset(e.target.value) })}
      />
    </Field>
  );
}

function AccountField({ value, problems, set }: FieldProps) {
  return (
    <Field
      label={t('Cloudflare account ID')}
      help={<Help text={t('Find it in the Cloudflare dashboard.')} problem={problems.account_id} />}
    >
      <Input
        className="max-w-80 font-mono"
        aria-invalid={!!problems.account_id}
        value={value.account_id ?? ''}
        onChange={(e) => set({ account_id: orUnset(e.target.value) })}
      />
    </Field>
  );
}

/** Provider, model, address and account, showing only the fields this provider uses. */
export function ModelFields(props: {
  modelRole: ModelRole;
  value: ModelConfig;
  onChange: (value: ModelConfig) => void;
}) {
  const { modelRole, value, onChange } = props;
  const shown = visibleFields(value);
  const fieldProps: FieldProps = {
    value,
    problems: modelProblems(value, modelRole),
    set: (patch) => onChange({ ...value, ...patch }),
  };
  return (
    <>
      <ServiceField {...fieldProps} modelRole={modelRole} />
      <ModelIdField {...fieldProps} />
      {shown.endpoint && <EndpointField {...fieldProps} />}
      {shown.account && <AccountField {...fieldProps} />}
    </>
  );
}
