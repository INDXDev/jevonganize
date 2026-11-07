/** The bottom bar of the window: counts, the latest message, the running job and quick switches. */
import { t } from '../i18n/index.ts';
import { Keyboard, LoaderCircle, MessageSquare } from 'lucide-react';
import type { Job } from '../../types.ts';
import { useTool } from '../api.ts';
import { cn, formatCount, keyLabel } from '../lib.ts';
import { goTo, toggle, useWindow } from '../tabs.ts';
import { Progress } from './ui/progress.tsx';

const STATUS_ITEM =
  'flex h-full items-center gap-1.5 px-2 hover:bg-surface-2 hover:text-foreground';

/** Events carry progress, so polling is only a fallback for an end missed while reconnecting. */
const POLL_WHILE_RUNNING_MS = 3000;

function JobStatus({ job }: { job: Job }) {
  const percent = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <button type="button" className={STATUS_ITEM} onClick={() => goTo('dashboard', 'history')}>
      <LoaderCircle className="spin size-3" />
      {t(job.kind)}
      {job.kind === 'scan' ? (
        // A scan does not know its total until it ends, so it shows a count, not a percentage.
        <>
          <Progress label={t('Scanning')} className="w-20" /> {formatCount(job.done)}
        </>
      ) : (
        <>
          <Progress label={t(job.kind)} className="w-20" value={job.done} max={job.total || 1} />
          {percent}%
        </>
      )}
    </button>
  );
}

/** How many files the list counts, and how many of them are selected. */
function FileCounts({ fallbackTotal }: { fallbackTotal: number }) {
  const selection = useWindow((s) => s.selection);
  const listTotal = useWindow((s) => s.total);
  const selectedCount = selection.all ? listTotal : selection.ids.size;
  return (
    <span className="px-3">
      {t('{count} files', { count: formatCount(listTotal ?? fallbackTotal) })}
      {selectedCount ? ` · ${t('{count} selected', { count: formatCount(selectedCount) })}` : ''}
    </span>
  );
}

/** The window's footer, which is also the polite live region for messages. */
export function StatusBar() {
  const { data: status } = useTool(
    'status',
    {},
    {
      refetchInterval: (query) => {
        const running = query.state.data?.jobs.some((job) => job.status === 'running');
        return running ? POLL_WHILE_RUNNING_MS : false;
      },
    },
  );
  const message = useWindow((s) => s.message);
  const chatOpen = useWindow((s) => s.chat);
  const runningJob = status?.jobs.find((job) => job.status === 'running');
  return (
    <footer className="flex h-6 shrink-0 items-center border-t border-strong bg-background font-mono text-xs text-subtle">
      <FileCounts fallbackTotal={status?.files ?? 0} />
      <output
        aria-live="polite"
        className={cn('min-w-0 flex-1 truncate', message?.error && 'text-destructive')}
      >
        {message?.text}
      </output>
      {runningJob && <JobStatus job={runningJob} />}
      <button type="button" className={STATUS_ITEM} onClick={() => goTo('tags', 'review')}>
        {t('Review')} {formatCount(status?.reviews ?? 0)}
      </button>
      <button
        type="button"
        className={STATUS_ITEM}
        onClick={() => useWindow.setState({ overlay: 'shortcuts' })}
      >
        <Keyboard className="size-3" /> ?
      </button>
      <button
        type="button"
        aria-pressed={chatOpen}
        className={cn(STATUS_ITEM, chatOpen && 'text-foreground')}
        onClick={() => toggle('chat')}
      >
        <MessageSquare className="size-3" /> {keyLabel('mod+i')} {t('Chat')}
      </button>
    </footer>
  );
}
