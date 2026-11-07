import { t } from '../i18n/index.ts';
import { Check, KeyRound, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ProviderName } from '../../types.ts';
import { useTool } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { Field, Input, Segmented, Select, Switch } from '../components/ui/field.tsx';
import { cn, useReset } from '../lib.ts';
import { setView } from '../tabs.ts';
import type { Config } from './settings-form.tsx';
import {
  canFollow,
  modelOf,
  modelProblems,
  PROVIDERS,
  providersFor,
  sameModel,
  visibleFields,
  type ModelConfig,
  type ModelRole,
} from './settings-models.ts';

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

type Keys = { provider: ProviderName; source: 'env' | 'file' | null }[];

function Problem({ text }: { text?: string }) {
  if (!text) return null;
  return <span className="mt-0.5 block text-xs text-destructive">{text}</span>;
}

function KeyStatus({ name, keys }: { name: ProviderName; keys: Keys }) {
  const source = keys.find((k) => k.provider === name)?.source ?? null;
  const local = PROVIDERS[name].endpoint === 'required';
  const ok = source !== null || local;
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      {ok ? (
        <Check aria-hidden className="size-3.5 shrink-0 text-ok" />
      ) : (
        <KeyRound aria-hidden className="size-3.5 shrink-0 text-warn" />
      )}
      <span className="min-w-0 flex-1 text-muted-foreground">
        {source
          ? t(KEY_SOURCE[source])
          : local
            ? t('No key. A local server may not need one.')
            : t('No key yet. Without one, nothing is sent.')}
      </span>
      {!source && (
        <Button variant="ghost" onClick={() => setView({ section: 'keys' })}>
          {t('Add a key')}
        </Button>
      )}
    </div>
  );
}

/** Provider, model, address and account, showing only the fields this provider uses. */
function ModelFields(props: {
  job: ModelRole;
  value: ModelConfig;
  onChange: (value: ModelConfig) => void;
}) {
  const { job: role, value, onChange } = props;
  const info = PROVIDERS[value.name];
  const shown = visibleFields(value);
  const problems = modelProblems(value, role);
  const set = (patch: Partial<ModelConfig>) => onChange({ ...value, ...patch });
  return (
    <>
      <Field
        label={t('AI service')}
        help={
          <>
            {t(BLURBS[value.name])}
            <Problem text={problems.name && t(problems.name)} />
          </>
        }
      >
        <Select
          label={t('AI service')}
          className="w-72"
          value={value.name}
          options={[...new Set([...providersFor(role), value.name])].map((name) => ({
            value: name,
            label: PROVIDERS[name].label,
          }))}
          onChange={(name) => set({ name: name as ProviderName })}
        />
      </Field>
      <Field
        label={t('Model')}
        help={
          <>
            {info.defaultModel
              ? t('Leave empty to use {model}.', { model: info.defaultModel })
              : t('The model id, such as {example}.', { example: info.modelExample ?? '' })}
            <Problem text={problems.model && t(problems.model)} />
          </>
        }
      >
        <Input
          className="max-w-80 font-mono"
          aria-invalid={!!problems.model}
          placeholder={info.defaultModel ?? info.modelExample}
          value={value.model ?? ''}
          onChange={(e) => set({ model: e.target.value || undefined })}
        />
      </Field>
      {shown.endpoint && (
        <Field
          label={t('Server address')}
          help={
            <>
              {info.endpoint === 'required'
                ? t('The address of your server, such as {example}.', {
                    example: info.endpointExample ?? '',
                  })
                : t(
                    "Requests go here instead of the service's own address. To remove it, edit config.toml.",
                  )}
              <Problem text={problems.base_url && t(problems.base_url)} />
            </>
          }
        >
          <Input
            className="max-w-96 font-mono"
            inputMode="url"
            aria-invalid={!!problems.base_url}
            placeholder={info.endpointExample}
            value={value.base_url ?? ''}
            onChange={(e) => set({ base_url: e.target.value || undefined })}
          />
        </Field>
      )}
      {shown.account && (
        <Field
          label={t('Cloudflare account ID')}
          help={
            <>
              {t('Find it in the Cloudflare dashboard.')}
              <Problem text={problems.account_id && t(problems.account_id)} />
            </>
          }
        >
          <Input
            className="max-w-80 font-mono"
            aria-invalid={!!problems.account_id}
            value={value.account_id ?? ''}
            onChange={(e) => set({ account_id: e.target.value || undefined })}
          />
        </Field>
      )}
    </>
  );
}

function Card(props: {
  id: string;
  title: string;
  badge?: string;
  purpose: string;
  sends: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${props.id}-title`}
      className="mb-4 rounded-lg border border-strong bg-surface-1 p-4"
    >
      <header className="mb-1 flex items-center gap-2">
        <h3 id={`${props.id}-title`} className="text-md font-medium">
          {props.title}
        </h3>
        {props.badge && (
          <span className="rounded-sm bg-soft px-1.5 py-px text-2xs text-foreground">
            {props.badge}
          </span>
        )}
      </header>
      <p className="text-sm text-muted-foreground">{props.purpose}</p>
      <p className="mb-2 text-xs text-subtle">{props.sends}</p>
      {props.children}
    </section>
  );
}

/** Runs `doctor`, which checks the saved key without sending anything to the provider. */
function CheckKey({ saved }: { saved: boolean }) {
  const { data, isFetching, refetch } = useTool('doctor', {}, { enabled: false });
  const check = data?.find((c) => c.name === 'key');
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button disabled={!saved || isFetching} onClick={() => void refetch()}>
        {t('Check the key')}
      </Button>
      {check ? (
        <span className={cn('flex items-center gap-1 text-sm', !check.ok && 'text-destructive')}>
          {check.ok ? (
            <Check aria-label={t('ok')} className="size-3.5 text-ok" />
          ) : (
            <X aria-label={t('failed')} className="size-3.5" />
          )}
          <span className="font-mono text-xs">{check.detail}</span>
        </span>
      ) : (
        <span className="text-xs text-subtle">
          {saved
            ? t('Checks the saved settings. Nothing is sent to the service.')
            : t('Save first to check these settings.')}
        </span>
      )}
    </div>
  );
}

type Follow = { chat: boolean; ner: boolean };

const describe = (m: ModelConfig) =>
  `${PROVIDERS[m.name]?.label ?? m.name} · ${m.model || PROVIDERS[m.name]?.defaultModel || '?'}`;

/** A helper model's card: follow the decision model, or set one of its own. */
function HelperCard(props: {
  job: 'chat' | 'ner';
  value: ModelConfig;
  decision: ModelConfig;
  following: boolean;
  onFollow: (on: boolean) => void;
  onChange: (value: ModelConfig) => void;
  keys: Keys;
}) {
  const { job: role, value, decision, following, onFollow, onChange, keys } = props;
  const can = canFollow(decision);
  const copy =
    role === 'chat'
      ? {
          title: t('Chat model'),
          purpose: t(
            'Talks with you in the chat panel, answers questions, and suggests new labels for open questions. It never decides tags.',
          ),
          sends: t('Sends: your messages, and the file names, paths and tags its tools look up.'),
        }
      : {
          title: t('Name-reading model'),
          purpose: t(
            'Reads proper names, such as people, companies and places, out of file text during Organize. They become entity: tags you can undo. It never chooses from your questions.',
          ),
          sends: t(
            'Sends: file text. If your decision model runs on your own server, set this too, or text goes to OpenAI.',
          ),
        };
  return (
    <Card id={role} title={copy.title} purpose={copy.purpose} sends={copy.sends}>
      <Field label={t('Which model')}>
        <Segmented
          label={t('Which model')}
          value={following && can ? 'same' : 'other'}
          options={[
            { value: 'same', label: t('Same as the decision model') },
            { value: 'other', label: t('A different model') },
          ]}
          onChange={(next) => (next === 'other' || can) && onFollow(next === 'same')}
        />
      </Field>
      {!can && (
        <p className="pb-1 text-xs text-subtle">
          {t('{service} only decides tags, so this needs a service that writes text.', {
            service: PROVIDERS[decision.name]?.label ?? decision.name,
          })}
        </p>
      )}
      {following && can ? (
        <p className="py-1 text-sm text-muted-foreground">
          {t('Uses {model}.', { model: describe(decision) })}
        </p>
      ) : (
        <>
          <ModelFields job={role} value={value} onChange={onChange} />
          <KeyStatus name={value.name} keys={keys} />
        </>
      )}
    </Card>
  );
}

const PROFILE_NAME = /^[a-z0-9_-]+$/i;

/** Named extra decision models, which a question set picks with `profile`. */
function Profiles(props: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const { value, onChange } = props;
  const [name, setName] = useState('');
  const valid = PROFILE_NAME.test(name) && !Object.hasOwn(value, name);
  return (
    <section className="mb-4">
      <h3 className="label mb-1">{t('Extra models for some questions')}</h3>
      <p className="mb-2 text-xs text-subtle">
        {t(
          'Optional. A question set uses one by naming it in profile. Each one used costs another request per file. To remove one, edit config.toml.',
        )}
      </p>
      {Object.entries(value).map(([key, table]) => (
        <div key={key} className="mb-2 rounded-md border p-3">
          <h4 className="mb-1 font-mono text-sm">{key}</h4>
          <ModelFields
            job="decision"
            value={modelOf(table)}
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        </div>
      ))}
      <div className="flex max-w-96 gap-2">
        <Input
          aria-label={t('New profile name')}
          placeholder={t('Name, such as vision')}
          className="font-mono"
          value={name}
          onChange={(e) => setName(e.target.value.trim())}
        />
        <Button
          disabled={!valid}
          onClick={() => {
            onChange({ ...value, [name]: { name: 'openai' } });
            setName('');
          }}
        >
          {t('Add')}
        </Button>
      </div>
    </section>
  );
}

/** Whether `[chat]` and `[ner]` match the decision model in `saved`, which is how "same" is stored. */
function followingIn(saved: Config): Follow {
  const decision = modelOf(saved.provider);
  return {
    chat: sameModel(modelOf(saved.chat), decision),
    ner: sameModel(modelOf(saved.ner), decision),
  };
}

/** Problems that keep the AI models page from saving, as a count. */
export function modelErrors(draft: Config): number {
  const tables: [unknown, ModelRole][] = [
    [draft.provider, 'decision'],
    [draft.chat, 'chat'],
    [draft.ner, 'ner'],
    ...Object.values((draft.profiles ?? {}) as Record<string, unknown>).map(
      (p) => [p, 'decision'] as [unknown, ModelRole],
    ),
  ];
  return tables
    .filter(([table]) => table !== undefined)
    .reduce((n, [table, role]) => n + Object.keys(modelProblems(modelOf(table), role)).length, 0);
}

/**
 * One page for the three models. "Same as the decision model" is not a config value: it copies
 * `[provider]` into `[chat]` or `[ner]`, and keeps copying while the decision model is edited.
 */
export function AiModels(props: {
  saved: Config;
  draft: Config;
  onChange: (draft: Config) => void;
  sendImages?: ReactNode;
}) {
  const { saved, draft, onChange } = props;
  const [follow, setFollow] = useState<Follow>(() => followingIn(saved));
  useReset(saved, () => setFollow(followingIn(saved)));
  const { data: keyData } = useTool('list_keys', {});
  const keys: Keys = keyData?.keys ?? [];

  const decision = modelOf(draft.provider);
  const savedDecision = sameModel(decision, modelOf(saved.provider));

  const changeDecision = (next: ModelConfig) => {
    const copy = canFollow(next) ? { ...next } : undefined;
    onChange({
      ...draft,
      provider: next,
      ...(follow.chat && copy ? { chat: copy } : {}),
      ...(follow.ner && copy ? { ner: copy } : {}),
    });
  };
  const setFollowing = (role: 'chat' | 'ner', on: boolean) => {
    setFollow({ ...follow, [role]: on });
    if (on) onChange({ ...draft, [role]: { ...decision } });
  };

  return (
    <>
      <Card
        id="decision"
        title={t('Decision model')}
        badge={t('Decides every tag')}
        purpose={t(
          'Answers your questions about each file by choosing from fixed labels. Every tag Organize or Refresh adds is decided here, never by the other two models.',
        )}
        sends={t(
          "Sends: each file's name, an excerpt of its text, up to the image limit, and metadata. You see the cost before a run.",
        )}
      >
        <ModelFields job="decision" value={decision} onChange={changeDecision} />
        <KeyStatus name={decision.name} keys={keys} />
        <CheckKey saved={savedDecision} />
        {props.sendImages}
      </Card>
      <HelperCard
        job="chat"
        value={modelOf(draft.chat)}
        decision={decision}
        following={follow.chat}
        onFollow={(on) => setFollowing('chat', on)}
        onChange={(chat) => onChange({ ...draft, chat })}
        keys={keys}
      />
      <HelperCard
        job="ner"
        value={modelOf(draft.ner)}
        decision={decision}
        following={follow.ner}
        onFollow={(on) => setFollowing('ner', on)}
        onChange={(ner) => onChange({ ...draft, ner })}
        keys={keys}
      />
      <Profiles
        value={(draft.profiles ?? {}) as Record<string, unknown>}
        onChange={(profiles) => onChange({ ...draft, profiles })}
      />
    </>
  );
}

/** The `send_images` switch, which belongs with what the decision model is sent. */
export function SendImages(props: { value: unknown; onChange: (on: boolean) => void }) {
  return (
    <Field
      label={t('Send images')}
      help={t('Off keeps every image on this machine, including rendered PDF pages')}
    >
      <Switch
        aria-label={t('Send images')}
        checked={props.value !== false}
        onCheckedChange={props.onChange}
      />
    </Field>
  );
}
