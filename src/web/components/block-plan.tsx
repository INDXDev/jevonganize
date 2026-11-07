/** A plan as a block: its tag changes, its files on request, and the buttons that decide it. */
import { t } from '../i18n/index.ts';
import { ChevronRight, Copy } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Plan, TagOp } from '../../types.ts';
import { act, call, useTool } from '../api.ts';
import { cn, formatCount, formatTime, keyLabel } from '../lib.ts';
import { notify } from '../tabs.ts';
import { BlockShell, type Tone } from './block-shell.tsx';
import { FileList } from './file-list.tsx';
import { TagChip } from './tag-chip.tsx';
import { Button } from './ui/button.tsx';

/** Overrides for a plan a model asked to apply: the buttons then answer its approval request. */
export type Approval = { onApply?: () => void; onDeny?: () => void };

const PLAN_TONES: Record<Plan['status'], Tone> = {
  proposed: 'wait',
  applying: 'wait',
  applied: 'ok',
  undone: 'off',
  failed: 'bad',
};

// shortcut: no tool resolves many ids at once, so only the first 50 ops are named. Add one for more.
const MAX_NAMED_FILES = 50;
const MAX_ADDED_CHIPS = 4;
const MAX_REMOVED_CHIPS = 2;
const MAX_ERRORS = 5;

const copyToClipboard = (text: string) =>
  void navigator.clipboard.writeText(text).then(
    () => notify(t('Copied: {text}', { text })),
    () => notify(t('Could not copy'), true),
  );

/** A tag-to-file-count record as pairs, the tags on most files first. */
const byFileCount = (counts: Record<string, number>) =>
  Object.entries(counts).toSorted((a, b) => b[1] - a[1]);

const sumCounts = (pairs: [string, number][]) => pairs.reduce((sum, [, count]) => sum + count, 0);

/** The rows of the files these ops touch, as each one loads. */
function useFilesOf(ops: TagOp[]) {
  const fileQueries = useQueries({
    queries: ops.map((op) => ({
      queryKey: ['get_file', { id: op.file_id }],
      queryFn: () => call('get_file', { id: op.file_id }),
    })),
  });
  return fileQueries.flatMap((query) => (query.data ? [query.data] : []));
}

/** How many tags one file gains and loses, such as `+2 −1`. */
function OpCounts({ op }: { op: TagOp | undefined }) {
  const gained = op?.add.length ? `+${op.add.length}` : '';
  const lost = op?.remove.length ? `−${op.remove.length}` : '';
  return (
    <span className="truncate font-mono text-xs text-subtle">
      {gained} {lost}
    </span>
  );
}

/** The files a plan touches, each with how many tags it gains and loses. */
function Changes({ id }: { id: string }) {
  const { data: plan } = useTool('get_plan', { id });
  const namedOps = plan?.ops.slice(0, MAX_NAMED_FILES) ?? [];
  const opByFile = new Map<number, TagOp>(namedOps.map((op) => [op.file_id, op]));
  const rows = useFilesOf(namedOps);
  if (!plan) return <p className="text-subtle">{t('Loading changes')}</p>;
  return (
    <div className="-mx-1 rounded-sm border bg-surface-1 p-1">
      <FileList
        mode="compact"
        rows={rows}
        label={t('Files in this plan')}
        renderTrailing={(row) => <OpCounts op={opByFile.get(row.id)} />}
      />
      {plan.ops.length > namedOps.length && (
        <p className="px-1.5 pt-1 text-xs text-subtle">
          {t('First {shown} of {total} files', {
            shown: namedOps.length,
            total: formatCount(plan.ops.length),
          })}
        </p>
      )}
    </div>
  );
}

type PlanFooterProps = {
  plan: Plan;
  changesShown: boolean;
  onToggle: () => void;
  apply: () => void;
  onDeny?: Approval['onDeny'];
  cliCommand: string;
};

function PlanFooter(props: PlanFooterProps) {
  const { plan, changesShown, onToggle, apply, onDeny, cliCommand } = props;
  const isProposed = plan.status === 'proposed';
  const discard = () => void act('discard_plan', { id: plan.id });
  return (
    <footer className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-expanded={changesShown}
        onClick={onToggle}
        className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('size-3', changesShown && 'rotate-90')} />
        {changesShown ? t('Hide changes') : t('Show changes')}
      </button>
      {isProposed && (
        <Button variant="ghost" onClick={onDeny ?? discard}>
          {onDeny ? t('Deny') : t('Discard')}
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={() => copyToClipboard(cliCommand)}
        aria-label={t('Copy as CLI')}
      >
        <Copy /> CLI
      </Button>
      {plan.status === 'applied' && (
        <Button onClick={() => void act('undo_plan', { id: plan.id })}>{t('Undo')}</Button>
      )}
      {isProposed && (
        <Button variant="primary" onClick={apply}>
          {t('Apply')}
          <span className="font-mono text-2xs opacity-70">{keyLabel('mod+enter')}</span>
        </Button>
      )}
    </footer>
  );
}

/** The chips of the tags a plan adds and removes, the most used first. */
function TagChanges(props: { added: [string, number][]; removed: [string, number][] }) {
  const { added, removed } = props;
  const hiddenAdded = added.length - MAX_ADDED_CHIPS;
  return (
    <div className="flex flex-wrap gap-1">
      {added.slice(0, MAX_ADDED_CHIPS).map(([tag, count]) => (
        <TagChip key={tag} tag={tag} count={count} sign="+" />
      ))}
      {removed.slice(0, MAX_REMOVED_CHIPS).map(([tag, count]) => (
        <TagChip key={tag} tag={tag} count={count} sign="−" />
      ))}
      {hiddenAdded > 0 && (
        <span className="self-center font-mono text-xs text-subtle">+{hiddenAdded}</span>
      )}
    </div>
  );
}

/** Renamed tags that land on a name files already carry, so those files merge into it. */
function Merges({ merges }: { merges: NonNullable<Plan['merges']> }) {
  return merges.map((merge) => (
    <p key={merge.from} className="text-xs text-warn">
      {t('{count} files merge into existing {tag}', {
        count: formatCount(merge.files),
        tag: merge.into,
      })}
    </p>
  ));
}

/** The plan's size on one line: files, tags added and removed, and any errors. */
function PlanTotals(props: { files: number; added: number; removed: number; errors: number }) {
  const { files, added, removed, errors } = props;
  return (
    <p className="font-mono text-xs text-muted-foreground">
      {t('{count} files', { count: formatCount(files) })} · +{formatCount(added)} −
      {formatCount(removed)}
      {errors > 0 && ` · ${t('{count} errors', { count: errors })}`}
    </p>
  );
}

/** The first few files a failed plan could not change, each with its reason. */
function FailedFiles({ errors }: { errors: [string, string][] }) {
  return errors.slice(0, MAX_ERRORS).map(([fileId, reason]) => (
    <p key={fileId} className="font-mono text-xs text-destructive">
      {fileId}: {reason}
    </p>
  ));
}

/** A plan's block. Enter shows its files, and Mod+Enter applies it while it is proposed. */
export function PlanBlock({ plan, onApply, onDeny }: { plan: Plan } & Approval) {
  const [showChanges, setShowChanges] = useState(false);
  const toggleChanges = () => setShowChanges(!showChanges);
  const isProposed = plan.status === 'proposed';
  const apply = onApply ?? (() => void act('apply_plan', { id: plan.id }));
  const added = byFileCount(plan.summary.added);
  const removed = byFileCount(plan.summary.removed);
  const errors = Object.entries(plan.errors ?? {});
  const cliVerb = plan.status === 'applied' ? 'undo' : 'apply';
  const cliCommand = `jevonganize ${cliVerb} ${plan.id}`;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter') return;
    const withMod = event.metaKey || event.ctrlKey;
    if (!withMod) return toggleChanges();
    event.preventDefault();
    if (isProposed) apply();
  };
  return (
    <BlockShell
      tone={PLAN_TONES[plan.status]}
      title={plan.title}
      meta={`${plan.source} · ${formatTime(plan.created_at)}`}
      command={cliCommand}
      onKeyDown={onKeyDown}
    >
      <PlanTotals
        files={plan.summary.files}
        added={sumCounts(added)}
        removed={sumCounts(removed)}
        errors={errors.length}
      />
      <TagChanges added={added} removed={removed} />
      <Merges merges={plan.merges ?? []} />
      {plan.status === 'failed' && <FailedFiles errors={errors} />}
      {showChanges && <Changes id={plan.id} />}
      <PlanFooter
        plan={plan}
        changesShown={showChanges}
        onToggle={toggleChanges}
        apply={apply}
        onDeny={onDeny}
        cliCommand={cliCommand}
      />
    </BlockShell>
  );
}
