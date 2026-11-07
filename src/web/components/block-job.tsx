/** A job as a block: progress while it runs, and what it found once it ends. */
import { t } from '../i18n/index.ts';
import { Ban } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Job } from '../../types.ts';
import { act } from '../api.ts';
import { formatCost, formatCount, formatDuration } from '../lib.ts';
import { useTabs } from '../tabs.ts';
import { BlockShell, type Tone } from './block-shell.tsx';
import { Button } from './ui/button.tsx';
import { Progress } from './ui/progress.tsx';

const JOB_TITLES = {
  scan: 'Scanning',
  organize: 'Organizing',
  apply: 'Applying plan',
  undo: 'Undoing plan',
  refresh: 'Checking tag',
} as const;

/** The counts a scan reports, each with the word it is shown with. */
const SCAN_COUNTS = [
  ['added', 'new'],
  ['changed', 'changed'],
  ['moved', 'moved'],
  ['removed', 'removed'],
  ['restores', 'restore items'],
  ['skipped', 'skipped'],
] as const;

const MAX_WARNINGS = 5;

/** The time left, from the pace so far. */
function timeLeft(job: Job, now: number) {
  const msPerFile = (now - job.started_at) / job.done;
  return msPerFile * (job.total - job.done);
}

/** What the numbers say so far, in one line. */
function jobFacts(job: Job, now: number): string[] {
  const progress =
    job.kind === 'scan'
      ? t('{count} files', { count: formatCount(job.done) })
      : t('{done} of {total}', { done: formatCount(job.done), total: formatCount(job.total) });
  const facts = [progress];
  const { scan } = job;
  if (scan)
    for (const [key, word] of SCAN_COUNTS)
      if (scan[key])
        facts.push(t('{count} {kind}', { count: formatCount(scan[key]), kind: t(word) }));
  if (job.failed) facts.push(t('{count} failed', { count: formatCount(job.failed) }));
  if (job.tokens !== undefined) facts.push(t('{count} tokens', { count: formatCount(job.tokens) }));
  if (job.cost_usd !== undefined) facts.push(formatCost(job.cost_usd));
  const canEstimate = job.status === 'running' && job.done > 0 && job.total > job.done;
  if (canEstimate) facts.push(t('{time} left', { time: formatDuration(timeLeft(job, now)) }));
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

function toneOf(job: Job): Tone {
  if (job.status === 'running') return 'run';
  const allFailed = job.total > 0 && job.failed === job.total;
  return job.status === 'done' && !allFailed ? 'ok' : 'bad';
}

function RunningFooter({ job }: { job: Job }) {
  return (
    <footer className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle">{job.current}</span>
      <Button variant="ghost" onClick={() => void act('cancel_job', { id: job.id })}>
        <Ban />
        {t('Cancel')}
      </Button>
    </footer>
  );
}

/** A job's block. A scan's total is unknown while it runs, so it shows no percentage. */
export function JobBlock({ job }: { job: Job }) {
  const running = job.status === 'running';
  const now = useNow(running);
  const navigate = useTabs((s) => s.navigate);
  const totalKnown = job.kind !== 'scan' && job.total > 0;
  const percent = totalKnown ? ` ${Math.round((job.done / job.total) * 100)}%` : '';
  const title = t(JOB_TITLES[job.kind]);
  return (
    <BlockShell tone={toneOf(job)} title={`${title}${running ? percent : ''}`} meta={t(job.status)}>
      {running && (
        <Progress
          label={title}
          value={totalKnown ? job.done : undefined}
          max={totalKnown ? job.total : undefined}
        />
      )}
      <p className="font-mono text-xs text-muted-foreground">{jobFacts(job, now).join(' · ')}</p>
      {running && <RunningFooter job={job} />}
      {job.error && <p className="font-mono text-xs text-destructive">{job.error}</p>}
      {job.warnings?.slice(0, MAX_WARNINGS).map((warning) => (
        <p key={warning} className="truncate font-mono text-xs text-warn" title={warning}>
          {warning}
        </p>
      ))}
      {job.plan_id && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => navigate('screen=tags&section=review')}
        >
          {t('Plan {id}', { id: job.plan_id })}
        </button>
      )}
    </BlockShell>
  );
}
