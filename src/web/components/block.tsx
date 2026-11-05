import { Ban, Check, ChevronRight, Circle, Copy, LoaderCircle, Undo2, X } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Job, Plan, TagOp } from '../../types.ts';
import { act, call, useTool } from '../api.ts';
import { cn, formatCount, formatTime, keyLabel } from '../lib.ts';
import { notify, useTabs } from '../tabs.ts';
import { FileList } from './file-list.tsx';
import { TagChip } from './tag-chip.tsx';
import { Button } from './ui/button.tsx';

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
    () => notify(`Copied: ${text}`),
    () => notify('Could not copy', true),
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
  if (!plan) return <p className="text-subtle">Loading changes</p>;
  return (
    <div className="-mx-1 rounded-sm border bg-surface-1 p-1">
      <FileList
        mode="compact"
        rows={rows}
        label="Files in this plan"
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
          First {ops.length} of {formatCount(plan.ops.length)} files
        </p>
      )}
    </div>
  );
}

const total = (list: [string, number][]) => list.reduce((n, [, c]) => n + c, 0);

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
        {formatCount(summary.files)} files · +{formatCount(total(added))} −
        {formatCount(total(removed))}
        {errors.length > 0 && ` · ${errors.length} errors`}
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
      <footer className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3', open && 'rotate-90')} />
          {open ? 'Hide changes' : 'Show changes'}
        </button>
        {proposed && (
          <Button
            variant="ghost"
            onClick={onDeny ?? (() => void act('discard_plan', { id: plan.id }))}
          >
            {onDeny ? 'Deny' : 'Discard'}
          </Button>
        )}
        <Button variant="ghost" onClick={() => copy(command)} aria-label="Copy as CLI">
          <Copy /> CLI
        </Button>
        {plan.status === 'applied' && (
          <Button onClick={() => void act('undo_plan', { id: plan.id })}>Undo</Button>
        )}
        {proposed && (
          <Button variant="primary" onClick={apply}>
            Apply <span className="font-mono text-2xs opacity-70">{keyLabel('mod+enter')}</span>
          </Button>
        )}
      </footer>
    </Shell>
  );
}

const jobTitle: Record<Job['kind'], string> = {
  scan: 'Scanning',
  organize: 'Organizing',
  apply: 'Applying plan',
  undo: 'Undoing plan',
};

function JobBlock({ job }: { job: Job }) {
  const tone: Tone = job.status === 'running' ? 'run' : job.status === 'done' ? 'ok' : 'bad';
  const navigate = useTabs((s) => s.navigate);
  return (
    <Shell tone={tone} title={jobTitle[job.kind]} meta={job.status}>
      <p className="font-mono text-xs text-muted-foreground">
        {formatCount(job.done)} of {formatCount(job.total)}
        {job.tokens !== undefined && ` · ${formatCount(job.tokens)} tokens`}
        {job.cost_usd !== undefined &&
          ` · ${job.cost_usd === null ? 'cost unknown' : `$${job.cost_usd.toFixed(2)}`}`}
      </p>
      {job.status === 'running' && (
        <>
          <progress
            aria-label={jobTitle[job.kind]}
            value={job.done}
            max={job.total || 1}
            className="block h-0.5 w-full appearance-none [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:bg-primary"
          />
          <footer className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle">
              {job.current}
            </span>
            <Button variant="ghost" onClick={() => void act('cancel_job', { id: job.id })}>
              <Ban /> Cancel
            </Button>
          </footer>
        </>
      )}
      {job.error && <p className="font-mono text-xs text-destructive">{job.error}</p>}
      {job.plan_id && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => navigate('screen=review')}
        >
          Plan {job.plan_id}
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
