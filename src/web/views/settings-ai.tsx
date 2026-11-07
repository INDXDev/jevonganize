import { t } from '../i18n/index.ts';
import { useState, type ReactNode } from 'react';
import { useTool } from '../api.ts';
import { Field, Switch } from '../components/ui/field.tsx';
import { useReset } from '../lib.ts';
import { DecisionCard } from './settings-ai-decision.tsx';
import { HelperCard } from './settings-ai-helpers.tsx';
import { Profiles } from './settings-ai-profiles.tsx';
import type { Keys } from './settings-ai-fields.tsx';
import type { Config } from './settings-form.tsx';
import {
  canFollow,
  modelOf,
  profileTables,
  sameModel,
  type ModelConfig,
} from './settings-models.ts';

/** Whether each helper model copies the decision model, as "Same as the decision model" shows. */
type HelperFollowing = { chat: boolean; ner: boolean };

/** Whether `[chat]` and `[ner]` match the decision model in `saved`, which is how "same" is stored. */
function helpersFollowingIn(saved: Config): HelperFollowing {
  const decision = modelOf(saved.provider);
  return {
    chat: sameModel(modelOf(saved.chat), decision),
    ner: sameModel(modelOf(saved.ner), decision),
  };
}

type HelperRole = 'chat' | 'ner';

/**
 * Which helpers copy the decision model, and the edits that keep the copies in step: changing the
 * decision model rewrites each following helper, and turning following on copies it once.
 */
function useHelpersFollow(saved: Config, draft: Config, onChange: (draft: Config) => void) {
  const [helpersFollow, setHelpersFollow] = useState<HelperFollowing>(() =>
    helpersFollowingIn(saved),
  );
  useReset(saved, () => setHelpersFollow(helpersFollowingIn(saved)));
  const decision = modelOf(draft.provider);
  const changeDecision = (next: ModelConfig) => {
    const updated: Config = { ...draft, provider: next };
    // Helpers can copy only a decision model that writes text.
    if (canFollow(next)) {
      const decisionCopy = { ...next };
      if (helpersFollow.chat) updated.chat = decisionCopy;
      if (helpersFollow.ner) updated.ner = decisionCopy;
    }
    onChange(updated);
  };
  const setFollowing = (role: HelperRole, shouldFollow: boolean) => {
    setHelpersFollow({ ...helpersFollow, [role]: shouldFollow });
    if (shouldFollow) onChange({ ...draft, [role]: { ...decision } });
  };
  return { helpersFollow, changeDecision, setFollowing };
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
  const { helpersFollow, changeDecision, setFollowing } = useHelpersFollow(saved, draft, onChange);
  const { data: keyData } = useTool('list_keys', {});
  const keys: Keys = keyData?.keys ?? [];
  const decision = modelOf(draft.provider);
  const renderHelperCard = (role: HelperRole) => (
    <HelperCard
      decision={decision}
      keys={keys}
      modelRole={role}
      value={modelOf(draft[role])}
      following={helpersFollow[role]}
      onFollow={(on) => setFollowing(role, on)}
      onChange={(next) => onChange({ ...draft, [role]: next })}
    />
  );
  return (
    <>
      <DecisionCard
        decision={decision}
        isDecisionSaved={sameModel(decision, modelOf(saved.provider))}
        keys={keys}
        onChange={changeDecision}
        sendImages={props.sendImages}
      />
      {renderHelperCard('chat')}
      {renderHelperCard('ner')}
      <Profiles
        value={profileTables(draft)}
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
