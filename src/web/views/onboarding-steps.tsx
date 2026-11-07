import { t } from '../i18n/index.ts';
import { ArrowRight, Check, FolderOpen, TriangleAlert } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { Estimate, Library } from '../../types.ts';
import { SendNotice } from '../components/send-notice.tsx';
import { TopicPicker } from '../components/topic-picker.tsx';
import { Button } from '../components/ui/button.tsx';
import { Checkbox, Input } from '../components/ui/field.tsx';
import { cn, formatCost, formatCount, keyLabel, shortPath } from '../lib.ts';

/** How many files a first run covers unless the person asks for all of them. */
export const FIRST_RUN = 200;

function stepMarkTone(done: boolean | undefined, open: boolean) {
  if (done) return 'border-ok text-ok';
  return open ? 'border-primary text-primary' : 'border-control text-subtle';
}

function Step(props: {
  n: number;
  title: string;
  done?: boolean;
  open: boolean;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const { n, title, done, open, aside, children } = props;
  return (
    <li className={cn('relative grid grid-cols-[2rem_minmax(0,1fr)] pb-7', !open && 'opacity-45')}>
      <span
        aria-hidden
        className={cn(
          'z-10 grid size-5 place-items-center rounded-sm border bg-surface-1 font-mono text-xs',
          stepMarkTone(done, open),
        )}
      >
        {done ? <Check className="size-3" /> : n}
      </span>
      <div>
        <div className="flex h-5 items-center justify-between">
          <h2 className="text-lg font-medium">{title}</h2>
          {aside}
        </div>
        {open && <div className="mt-2 space-y-2">{children}</div>}
      </div>
    </li>
  );
}

/** Step 1: the key field, until a key is stored. */
export function KeyStep(props: {
  haveKey: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** `OPENAI_API_KEY` is set, and can be used with one click. */
  inEnv: boolean;
  fromEnv: boolean;
  onUseEnv: () => void;
}) {
  const { haveKey, value, onChange, onSave, inEnv, fromEnv, onUseEnv } = props;
  const getKeyLink = (
    <a
      href="https://platform.openai.com/api-keys"
      target="_blank"
      rel="noreferrer"
      className="text-xs text-subtle hover:text-foreground"
    >
      {t('Get a key ↗')}
    </a>
  );
  return (
    <Step n={1} title={t('OpenAI key')} open done={haveKey} aside={getKeyLink}>
      {!haveKey && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            aria-label={t('OpenAI API key')}
            placeholder="sk-…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono"
          />
          <Button type="submit" disabled={!value}>
            {t('Save')}
          </Button>
        </form>
      )}
      {!haveKey && inEnv && (
        <Button onClick={onUseEnv}>{t('Use OPENAI_API_KEY from the environment')}</Button>
      )}
      <p className="text-xs text-subtle">
        {!haveKey && t('Without one, you can still scan and browse.')}
        {haveKey &&
          (fromEnv ? t('Read from the environment.') : t('Stored in a file only you can read.'))}
      </p>
    </Step>
  );
}

/** Step 2: the chosen folder, with a warning when its volume cannot hold tags. */
export function FolderStep(props: {
  library?: Library;
  /** The count after the scan. `library` was read before the scan began. */
  files?: number;
  usable: boolean;
  onChoose: () => void;
}) {
  const { library, files, usable, onChoose } = props;
  return (
    <Step n={2} title={t('Folder')} open done={usable}>
      <div className="flex items-center gap-2">
        <Button onClick={onChoose}>
          <FolderOpen /> {library ? t('Change') : t('Choose a folder')}
        </Button>
        {library && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {shortPath(library.path)} ·{' '}
            {t('{count} files found', { count: formatCount(files ?? library.files) })}
          </span>
        )}
      </div>
      {library && !library.taggable && (
        <p className="flex items-center gap-1.5 text-xs text-warn">
          <TriangleAlert className="size-3" />
          {t('This volume cannot store tags. Pick another folder.')}
        </p>
      )}
    </Step>
  );
}

const packTitle = (id: string) => id[0]!.toUpperCase() + id.slice(1);

/** Step 3: one tick per preset pack. */
export function PacksStep(props: {
  usable: boolean;
  packs: { id: string; on: boolean }[];
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const { usable, packs, onToggle } = props;
  return (
    <Step n={3} title={t('Packs')} open={usable} done={usable}>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {packs.map((pack) => (
          <label key={pack.id} className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={pack.on} onCheckedChange={(on) => onToggle(pack.id, on === true)} />
            {packTitle(pack.id)}
          </label>
        ))}
      </div>
    </Step>
  );
}

/** Step 4: the catalog. */
export function TopicsStep(props: {
  usable: boolean;
  canChoose: boolean;
  picking: boolean;
  topics: string[];
  onChange: (topics: string[]) => void;
  onChoose: () => void;
}) {
  const { usable, canChoose, picking, topics, onChange, onChoose } = props;
  return (
    <Step n={4} title={t('Topics')} open={usable} done={topics.length > 0}>
      <TopicPicker
        topics={topics}
        canChoose={canChoose}
        picking={picking}
        onAdd={(value) => onChange([...topics, value])}
        onRemove={(value) => onChange(topics.filter((topic) => topic !== value))}
        onChoose={onChoose}
      />
    </Step>
  );
}

/** Step 5: the send notice, and the choice to go past the first-run limit. */
export function CostStep(props: {
  usable: boolean;
  provider: string;
  estimate?: Estimate;
  wholeFolder?: Estimate;
  coverAll: boolean;
  onCoverAll: (coverAll: boolean) => void;
}) {
  const { usable, provider, estimate, wholeFolder, coverAll, onCoverAll } = props;
  return (
    <Step n={5} title={t('Before you start')} open={usable}>
      <SendNotice estimate={estimate} provider={provider} />
      {wholeFolder && wholeFolder.files > FIRST_RUN && (
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Checkbox checked={coverAll} onCheckedChange={(on) => onCoverAll(on === true)} />{' '}
          {t('All {count} files, {cost}', {
            count: formatCount(wholeFolder.files),
            cost: formatCost(wholeFolder.cost_usd),
          })}
        </label>
      )}
    </Step>
  );
}

/** The product name and its promise, above the steps. */
export function Intro() {
  return (
    <header className="mb-8">
      <h1 className="flex items-center gap-2.5 font-mono text-2xl tracking-tight">
        <img src="/icon.svg" alt="" className="size-8 rounded-md" /> jevonganize
      </h1>
      <p className="mt-2 text-md text-muted-foreground">
        {' '}
        {t(
          'It never moves, renames, edits or deletes a file. It only writes tags, and every run can be undone.',
        )}{' '}
      </p>
    </header>
  );
}

/** Skip and Organize, under the steps. */
export function StartBar(props: {
  startRef: Ref<HTMLButtonElement>;
  canStart: boolean;
  onSkip: () => void;
  onStart: () => void;
}) {
  const { startRef, canStart, onSkip, onStart } = props;
  return (
    <footer className="mt-3 flex items-center justify-end gap-2">
      <Button variant="ghost" onClick={onSkip}>
        {t('Skip for now')}
      </Button>
      <Button variant="primary" ref={startRef} disabled={!canStart} onClick={onStart}>
        {' '}
        {t('Organize')} <ArrowRight />{' '}
        <span className="font-mono text-2xs opacity-70">{keyLabel('enter')}</span>
      </Button>
    </footer>
  );
}
