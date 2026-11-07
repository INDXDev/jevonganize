import { t } from '../i18n/index.ts';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTool } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { cn } from '../lib.ts';
import { KeyStatus, ModelFields, type Keys } from './settings-ai-fields.tsx';
import type { ModelConfig } from './settings-models.ts';

/** A model's card: what it is for, what it sends, then its settings. */
export function Card(props: {
  id: string;
  title: string;
  badge?: string;
  purpose: string;
  sends: string;
  children: ReactNode;
}) {
  const titleId = `${props.id}-title`;
  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 rounded-lg border border-strong bg-surface-1 p-4"
    >
      <header className="mb-1 flex items-center gap-2">
        <h3 id={titleId} className="text-md font-medium">
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
export function CheckKey({ saved }: { saved: boolean }) {
  const { data, isFetching, refetch } = useTool('doctor', {}, { enabled: false });
  const keyCheck = data?.find((check) => check.name === 'key');
  const hint = saved
    ? t('Checks the saved settings. Nothing is sent to the service.')
    : t('Save first to check these settings.');
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button disabled={!saved || isFetching} onClick={() => void refetch()}>
        {t('Check the key')}
      </Button>
      {keyCheck ? (
        <span className={cn('flex items-center gap-1 text-sm', !keyCheck.ok && 'text-destructive')}>
          {keyCheck.ok ? (
            <Check aria-label={t('ok')} className="size-3.5 text-ok" />
          ) : (
            <X aria-label={t('failed')} className="size-3.5" />
          )}
          <span className="font-mono text-xs">{keyCheck.detail}</span>
        </span>
      ) : (
        <span className="text-xs text-subtle">{hint}</span>
      )}
    </div>
  );
}

/** The decision model's card, with its key, the key check and what it is sent. */
export function DecisionCard(props: {
  decision: ModelConfig;
  isDecisionSaved: boolean;
  keys: Keys;
  onChange: (next: ModelConfig) => void;
  sendImages?: ReactNode;
}) {
  const { decision, isDecisionSaved, keys, onChange, sendImages } = props;
  return (
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
      <ModelFields modelRole="decision" value={decision} onChange={onChange} />
      <KeyStatus name={decision.name} keys={keys} />
      <CheckKey saved={isDecisionSaved} />
      {sendImages}
    </Card>
  );
}
