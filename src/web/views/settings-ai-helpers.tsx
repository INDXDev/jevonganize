import { t } from '../i18n/index.ts';
import { Field, Segmented } from '../components/ui/field.tsx';
import { Card } from './settings-ai-decision.tsx';
import { KeyStatus, ModelFields, type Keys } from './settings-ai-fields.tsx';
import { canFollow, type ModelConfig } from './settings-models.ts';
import { PROVIDERS } from './settings-providers.ts';

/** The service and model, as one line such as "OpenAI · gpt-5". */
const describeModel = (model: ModelConfig) => {
  const provider = PROVIDERS[model.name];
  const serviceName = provider?.label ?? model.name;
  const modelId = model.model || provider?.defaultModel || '?';
  return `${serviceName} · ${modelId}`;
};

type HelperRole = 'chat' | 'ner';

function helperCopy(role: HelperRole) {
  if (role === 'chat') {
    return {
      title: t('Chat model'),
      purpose: t(
        'Talks with you in the chat panel, answers questions, and suggests new labels for open questions. It never decides tags.',
      ),
      sends: t('Sends: your messages, and the file names, paths and tags its tools look up.'),
    };
  }
  return {
    title: t('Name-reading model'),
    purpose: t(
      'Reads proper names, such as people, companies and places, out of file text during Organize. They become entity: tags you can undo. It never chooses from your questions.',
    ),
    sends: t(
      'Sends: file text. If your decision model runs on your own server, set this too, or text goes to OpenAI.',
    ),
  };
}

/** A helper model's card: follow the decision model, or set one of its own. */
export function HelperCard(props: {
  modelRole: HelperRole;
  value: ModelConfig;
  decision: ModelConfig;
  following: boolean;
  onFollow: (on: boolean) => void;
  onChange: (value: ModelConfig) => void;
  keys: Keys;
}) {
  const { modelRole, value, decision, following, onFollow, onChange, keys } = props;
  const decisionWritesText = canFollow(decision);
  // A decision model that only picks labels cannot chat or read names, so it cannot be followed.
  const usesDecisionModel = following && decisionWritesText;
  const chooseSource = (next: string) => {
    if (next === 'other' || decisionWritesText) onFollow(next === 'same');
  };
  const copy = helperCopy(modelRole);
  return (
    <Card id={modelRole} title={copy.title} purpose={copy.purpose} sends={copy.sends}>
      <Field label={t('Which model')}>
        <Segmented
          label={t('Which model')}
          value={usesDecisionModel ? 'same' : 'other'}
          options={[
            { value: 'same', label: t('Same as the decision model') },
            { value: 'other', label: t('A different model') },
          ]}
          onChange={chooseSource}
        />
      </Field>
      {!decisionWritesText && (
        <p className="pb-1 text-xs text-subtle">
          {t('{service} only decides tags, so this needs a service that writes text.', {
            service: PROVIDERS[decision.name]?.label ?? decision.name,
          })}
        </p>
      )}
      {usesDecisionModel ? (
        <p className="py-1 text-sm text-muted-foreground">
          {t('Uses {model}.', { model: describeModel(decision) })}
        </p>
      ) : (
        <>
          <ModelFields modelRole={modelRole} value={value} onChange={onChange} />
          <KeyStatus name={value.name} keys={keys} />
        </>
      )}
    </Card>
  );
}
