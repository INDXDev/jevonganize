/** Server events: they keep the query cache in step with jobs, tag writes and the review queue. */
import { t } from './i18n/index.ts';
import { useEffect } from 'react';
import type { Job, ServerEvent, Status } from '../types.ts';
import type { ToolName } from '../tool-map.ts';
import { applyPlanIfAsked, invalidate, mock, queryClient, STATUS_KEY } from './api.ts';
import { JOB_READS } from './refresh.ts';
import { notify } from './tabs.ts';

/** What the status bar says when a job of each kind has finished. */
const DONE_MESSAGES: Record<Job['kind'], (job: Job) => string> = {
  scan: (job) => t('Scan finished: {count} files', { count: job.scan?.files ?? job.done }),
  organize: (job) =>
    job.plan_id
      ? t('Organized {count} files. Its plan is ready', { count: job.done })
      : t('Organized {count} files', { count: job.done }),
  apply: (job) => t('Plan applied to {count} files', { count: job.done }),
  undo: (job) => t('Plan undone on {count} files', { count: job.done }),
  refresh: (job) => t('Checked {count} files for a tag', { count: job.done }),
};

/** The reads that list or count files, which any change to a file's tags can alter. */
const FILE_READS: ToolName[] = [
  'search_files',
  'list_folders',
  'list_tags',
  'similar_files',
  'status',
  'list_vfolders',
  'vfolder_files',
];

/** A job moved on: the status shows it at once, and its end refreshes what it changed. */
function onJobEvent(job: Job) {
  queryClient.setQueryData<Status>(STATUS_KEY, (status) => {
    if (!status) return status;
    const otherJobs = status.jobs.filter((known) => known.id !== job.id);
    return { ...status, jobs: [job, ...otherJobs] };
  });
  if (job.status === 'running') return;
  invalidate(...JOB_READS);
  applyPlanIfAsked(job);
  if (job.status === 'done') notify(DONE_MESSAGES[job.kind](job));
  if (job.status === 'failed')
    notify(job.error ?? t('The {kind} job failed', { kind: t(job.kind) }), true);
}

/** Tags changed on these files: refresh the lists, and the open details of just these files. */
function onFilesEvent(fileIds: number[]) {
  invalidate(...FILE_READS);
  const changed = new Set(fileIds);
  void queryClient.invalidateQueries({
    queryKey: ['get_file'],
    predicate: (query) => changed.has((query.queryKey[1] as { id: number }).id),
  });
}

function onReviewsEvent(count: number) {
  queryClient.setQueryData<Status>(STATUS_KEY, (status) => status && { ...status, reviews: count });
  invalidate('list_reviews');
}

function onEvent(event: ServerEvent) {
  if (event.type === 'job') onJobEvent(event.job);
  else if (event.type === 'files') onFilesEvent(event.ids);
  else onReviewsEvent(event.count);
}

/** Keeps queries in step with `/api/events` while the app is mounted. */
export function useEvents() {
  useEffect(() => {
    if (mock) return mock.subscribe(onEvent);
    const source = new EventSource('/api/events');
    const onMessage = (message: MessageEvent) =>
      onEvent(JSON.parse(message.data as string) as ServerEvent);
    source.addEventListener('message', onMessage);
    return () => source.close();
  }, []);
}
