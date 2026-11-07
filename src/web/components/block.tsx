import { t } from '../i18n/index.ts';
import { Ban, Check, ChevronRight, Circle, Copy, LoaderCircle, Undo2, X } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Job, Plan, TagOp } from '../../types.ts';
import { act, call, useTool } from '../api.ts';
import { cn, formatCost, formatCount, formatDuration, formatTime, keyLabel } from '../lib.ts';
import { notify, useTabs } from '../tabs.ts';
import { FileList } from './file-list.tsx';
import { TagChip } from './tag-chip.tsx';
import { Button } from './ui/button.tsx';
import { Progress } from './ui/progress.tsx';

type Tone = 'wait' | 'run' | 'ok' | 'bad' | 'off';

const tones: Record<Tone, { rule: string; icon: ReactNode }> = {
  wait: { rule: 'bg-primary', icon: <Circle className="text-primary" /> },
  run: { rule: 'bg-primary', icon: <LoaderCircle className="spin text-primary" /> },
  ok: { rule: 'bg-ok', icon: <Check className="text-ok" /> },
  bad: { rule: 'bg-destructive', icon: <X className="text-destructive" /> },
  off: { rule: 'bg-control', icon: <Undo2 className="text-subtle" /> },
};

const planTone: Record<Plan['status'], Tone> = {
  proposed: 'wait',
  applying: 'wait',
  applied: 'ok',
  undone: 'off',
  failed: 'bad',
};

const copy = (text: string) =>
  void navigator.clipboard.writeText(text).then(
    () => notify(t('Copied: {text}', { text })),
    () => notify(t('Could not copy'), true),
  );

function Shell(props: {
  tone: Tone;
  title: ReactNode;
  meta?: ReactNode;
  command?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  children?: ReactNode;
}) {
  const { tone, title, meta, command, children, onKeyDown } = props;
  return (
    // A block takes Enter and Mod+Enter itself, per the keyboard map, so it must hold focus.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={onKeyDown ? 0 : undefined}
      onKeyDown={onKeyDown}
      className="relative overflow-hidden rounded-md border bg-surface-2"
    >
      <span className={cn('absolute inset-y-0 left-0 w-0.5', tones[tone].rule)} />
      <header className="flex items-center gap-2 pt-2 pr-2.5 pl-3">
        <span className="shrink-0 [&_svg]:size-3.5">{tones[tone].icon}</span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
        <span className="shrink-0 font-mono text-xs text-subtle">{meta}</span>
      </header>
      {command && (
        <div className="group flex items-center gap-1.5 pt-0.5 pr-2.5 pl-3 font-mono text-xs text-subtle">
          <span aria-hidden className="text-muted-foreground">
            ❯
          </span>
          <code className="min-w-0 truncate">{command}</code>
        </div>
      )}
      <div className="space-y-2 pt-1.5 pr-2.5 pb-2.5 pl-3 text-sm">{children}</div>
    </article>
  );
}

function Changes({ id }: { id: string }) {
  const { data: plan } = useTool('get_plan', { id });
  // shortcut: no tool resolves many ids at once, so only the first 50 ops are named. Add one for more.
  const ops = plan?.ops.slice(0, 50) ?? [];
  const byFile = new Map<number, TagOp>(ops.map((op) => [op.file_id, op]));
  const files = useQueries({
    queries: ops.map((op) => ({
      queryKey: ['get_file', { id: op.file_id }],
      queryFn: () => call('get_file', { id: op.file_id }),
    })),
  });
  const rows = files.flatMap((f) => (f.data ? [f.data] : []));
  if (!plan) return <p className="text-subtle">{t('Loading changes')}</p>;
  return (
    <div className="-mx-1 rounded-sm border bg-surface-1 p-1">
      <FileList
        mode="compact"
        rows={rows}
        label={t('Files in this plan')}
        renderTrailing={(row) => {
          const op = byFile.get(row.id);
          return (
            <span className="truncate font-mono text-xs text-subtle">
              {op?.add.length ? `+${op.add.length}` : ''}{' '}
              {op?.remove.length ? `−${op.remove.length}` : ''}
            </span>
          );
        }}
      />
      {plan.ops.length > ops.length && (
        <p className="px-1.5 pt-1 text-xs text-subtle">
          {t('First {shown} of {total} files', {
            shown: ops.length,
            total: formatCount(plan.ops.length),
          })}
        </p>
      )}
    </div>
  );
}

const total = (list: [string, number][]) => list.reduce((n, [, c]) => n + c, 0);

type PlanFooterProps = {
  plan: Plan;
  open: boolean;
  onToggle: () => void;
  apply: () => void;
  onDeny?: Approval['onDeny'];
  command: string;
};

function PlanFooter({ plan, open, onToggle, apply, onDeny, command }: PlanFooterProps) {
  const proposed = plan.status === 'proposed';
  return (
    <footer className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('size-3', open && 'rotate-90')} />
        {open ? t('Hide changes') : t('Show changes')}
      </button>
      {proposed && (
        <Button
          variant="ghost"
          onClick={onDeny ?? (() => void act('discard_plan', { id: plan.id }))}
        >
          {onDeny ? t('Deny') : t('Discard')}
        </Button>
      )}
      <Button variant="ghost" onClick={() => copy(command)} aria-label={t('Copy as CLI')}>
        <Copy /> CLI
      </Button>
      {plan.status === 'applied' && (
        <Button onClick={() => void act('undo_plan', { id: plan.id })}>{t('Undo')}</Button>
      )}
      {proposed && (
        <Button variant="primary" onClick={apply}>
          {t('Apply')}
          <span className="font-mono text-2xs opacity-70">{keyLabel('mod+enter')}</span>
        </Button>
      )}
    </footer>
  );
}

function PlanBlock({ plan, onApply, onDeny }: { plan: Plan } & Approval) {
  const [open, setOpen] = useState(false);
  const { summary } = plan;
  const proposed = plan.status === 'proposed';
  const apply = onApply ?? (() => void act('apply_plan', { id: plan.id }));
  const added = Object.entries(summary.added).toSorted((a, b) => b[1] - a[1]);
  const removed = Object.entries(summary.removed).toSorted((a, b) => b[1] - a[1]);
  const errors = Object.entries(plan.errors ?? {});
  const verb = plan.status === 'applied' ? 'undo' : 'apply';
  const command = `jevonganize ${verb} ${plan.id}`;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (proposed) apply();
    } else if (e.key === 'Enter') setOpen(!open);
  };
  return (
    <Shell
      tone={planTone[plan.status]}
      title={plan.title}
      meta={`${plan.source} · ${formatTime(plan.created_at)}`}
      command={command}
      onKeyDown={onKeyDown}
    >
      <p className="font-mono text-xs text-muted-foreground">
        {t('{count} files', { count: formatCount(summary.files) })} · +{formatCount(total(added))} −
        {formatCount(total(removed))}
        {errors.length > 0 && ` · ${t('{count} errors', { count: errors.length })}`}
      </p>
      <div className="flex flex-wrap gap-1">
        {added.slice(0, 4).map(([tag, count]) => (
          <TagChip key={tag} tag={tag} count={count} sign="+" />
        ))}
        {removed.slice(0, 2).map(([tag, count]) => (
          <TagChip key={tag} tag={tag} count={count} sign="−" />
        ))}
        {added.length > 4 && (
          <span className="self-center font-mono text-xs text-subtle">+{added.length - 4}</span>
        )}
      </div>
      {plan.status === 'failed' &&
        errors.slice(0, 5).map(([id, reason]) => (
          <p key={id} className="font-mono text-xs text-destructive">
            {id}: {reason}
          </p>
        ))}
      {open && <Changes id={plan.id} />}
      <PlanFooter
        plan={plan}
        open={open}
        onToggle={() => setOpen(!open)}
        apply={apply}
        onDeny={onDeny}
        command={command}
      />
    </Shell>
  );
}

const jobTitle = {
  scan: 'Scanning',
  organize: 'Organizing',
  apply: 'Applying plan',
  undo: 'Undoing plan',
  refresh: 'Checking tag',
} as const;

const FOUND = [
  ['added', 'new'],
  ['changed', 'changed'],
  ['moved', 'moved'],
  ['removed', 'removed'],
  ['restores', 'restore items'],
  ['skipped', 'skipped'],
] as const;

/** What the numbers say so far, in one line. */
function jobFacts(job: Job, now: number): string[] {
  const running = job.status === 'running';
  const facts = [
    job.kind === 'scan'
      ? t('{count} files', { count: formatCount(job.done) })
      : t('{done} of {total}', { done: formatCount(job.done), total: formatCount(job.total) }),
  ];
  const { scan } = job;
  if (scan)
    for (const [key, word] of FOUND)
      if (scan[key])
        facts.push(t('{count} {kind}', { count: formatCount(scan[key]), kind: t(word) }));
  if (job.failed) facts.push(t('{count} failed', { count: formatCount(job.failed) }));
  if (job.tokens !== undefined) facts.push(t('{count} tokens', { count: formatCount(job.tokens) }));
  if (job.cost_usd !== undefined) facts.push(formatCost(job.cost_usd));
  if (running && job.done > 0 && job.total > job.done) {
    const left = ((now - job.started_at) / job.done) * (job.total - job.done);
    facts.push(t('{time} left', { time: formatDuration(left) }));
  }
  return facts;
}

/** The clock, ticking while `live`, so time left moves between events. */
function useNow(live: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

function JobBlock({ job }: { job: Job }) {
  const running = job.status === 'running';
  const now = useNow(running);
  const allFailed = job.total > 0 && job.failed === job.total;
  const tone: Tone = running ? 'run' : job.status === 'done' && !allFailed ? 'ok' : 'bad';
  const navigate = useTabs((s) => s.navigate);
  const known = job.kind !== 'scan' && job.total > 0;
  const percent = known ? ` ${Math.round((job.done / job.total) * 100)}%` : '';
  return (
    <Shell
      tone={tone}
      title={`${t(jobTitle[job.kind])}${running ? percent : ''}`}
      meta={t(job.status)}
    >
      {running && (
        <Progress
          label={t(jobTitle[job.kind])}
          value={known ? job.done : undefined}
          max={known ? job.total : undefined}
        />
      )}
      <p className="font-mono text-xs text-muted-foreground">{jobFacts(job, now).join(' · ')}</p>
      {running && (
        <footer className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle">
            {job.current}
          </span>
          <Button variant="ghost" onClick={() => void act('cancel_job', { id: job.id })}>
            <Ban />
            {t('Cancel')}
          </Button>
        </footer>
      )}
      {job.error && <p className="font-mono text-xs text-destructive">{job.error}</p>}
      {job.warnings?.slice(0, 5).map((warning) => (
        <p key={warning} className="truncate font-mono text-xs text-warn" title={warning}>
          {warning}
        </p>
      ))}
      {job.plan_id && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => navigate('screen=review')}
        >
          {t('Plan {id}', { id: job.plan_id })}
        </button>
      )}
    </Shell>
  );
}

function ToolBlock({ tool }: { tool: { name: string; output: unknown } }) {
  const text = JSON.stringify(tool.output, null, 1) ?? '';
  return (
    <Shell tone="ok" title={tool.name}>
      <pre className="max-h-40 overflow-hidden font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
        {text.length > 1200 ? `${text.slice(0, 1200)}…` : text}
      </pre>
    </Shell>
  );
}

/** Overrides for a plan a model asked to apply: the buttons then answer its approval request. */
type Approval = { onApply?: () => void; onDeny?: () => void };

type Props =
  | ({ plan: Plan; job?: never; tool?: never } & Approval)
  | ({ job: Job; plan?: never; tool?: never } & Approval)
  | ({ tool: { name: string; output: unknown }; plan?: never; job?: never } & Approval);

/** The only way to show a plan, a job or a tool result. */
export function Block({ plan, job, tool, ...approval }: Props) {
  if (plan) return <PlanBlock plan={plan} {...approval} />;
  if (job) return <JobBlock job={job} />;
  return <ToolBlock tool={tool} />;
}
