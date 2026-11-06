import { t } from './i18n/index.ts';
/** The UI's only door to the server: tool calls, events, and file URLs. */
import { QueryClient, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ViewOptions } from '../core/config.ts';
import type { FileRow, Job, ServerEvent, Status, ToolMap, ToolName } from '../types.ts';
import { notify } from './tabs.ts';
import type { TagColors } from './tag-colors.ts';
import { JOB_READS, refreshedBy } from './refresh.ts';
import { pathSep } from './view-query.ts';

// The condition folds to false in a production build, which drops the mock from the bundle.
const mock = import.meta.env.VITE_MOCK === '1' ? await import('./dev/mock.ts') : null;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
});

/** Runs one tool on the server. Throws an `Error` with the server's message when it refuses. */
export async function call<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
  signal?: AbortSignal,
): Promise<ToolMap[K][1]> {
  if (mock) return mock.call(tool, input);
  const res = await fetch(`/api/call/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  const body = (await res.json().catch(() => null)) as
    | { ok: true; data: ToolMap[K][1] }
    | { ok: false; error: string }
    | null;
  if (!body) throw new Error(t('Server error {status}', { status: res.status }));
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

/** A read tool as a cached query. */
export function useTool<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
  options?: Omit<UseQueryOptions<ToolMap[K][1]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ToolMap[K][1]>({
    queryKey: [tool, input],
    queryFn: () => call(tool, input),
    ...options,
  });
}

/** The `tag_colors` config. Every chip reads it, so it never refetches on its own. */
export function useTagColors() {
  const { data } = useTool('get_config', {}, { staleTime: Infinity });
  return data?.config.tag_colors as TagColors | undefined;
}

type LoadedConfig = ToolMap['get_config'][1];

/** The `[view]` config. The shell waits for it, so views can rely on it. */
export const viewOptions = () =>
  queryClient.getQueryData<LoadedConfig>(['get_config', {}])?.config.view as ViewOptions;

export function useViewOptions() {
  const { data } = useTool('get_config', {}, { staleTime: Infinity });
  return data?.config.view as ViewOptions;
}

/** Shows a change at once, without saving it: for a slider while it is being dragged. */
export const previewView = (change: Partial<ViewOptions>) =>
  queryClient.setQueryData<LoadedConfig>(
    ['get_config', {}],
    (data) =>
      data && { ...data, config: { ...data.config, view: { ...viewOptions(), ...change } } },
  );

let savingView: Promise<unknown> = Promise.resolve();

/** Saves in order, and does not refetch: a late answer would undo a slider that has moved on. */
export function saveView(change: Partial<ViewOptions>) {
  previewView(change);
  savingView = savingView
    .then(() => call('set_config', { view: change }))
    .catch((error: unknown) => {
      notify((error as Error).message, true);
      void queryClient.invalidateQueries({ queryKey: ['get_config'] });
    });
}

/** A write from a button or key: refreshes what is on screen, and reports failure in the status bar. */
export async function act<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
): Promise<ToolMap[K][1] | undefined> {
  try {
    const data = await call(tool, input);
    const reads = refreshedBy(tool);
    if (reads) invalidate(...reads);
    else void queryClient.invalidateQueries();
    return data;
  } catch (error) {
    notify((error as Error).message, true);
    return undefined;
  }
}

/** A direct tag edit by a person: the change is its own approval, so it applies at once. */
export async function editTags(fileId: number, change: { add?: string[]; remove?: string[] }) {
  const title = t('Edit tags on file {id}', { id: fileId });
  const plan = await act('propose_changes', { file_ids: [fileId], ...change, title });
  if (plan) await act('apply_plan', { id: plan.id });
}

/** Settles review items. Accepting builds a plan, and the key press is its approval. */
export async function resolveReviews(ids: number[], accept: boolean) {
  const plan = await act('resolve_reviews', { ids, accept });
  if (plan?.status === 'proposed') await act('apply_plan', { id: plan.id });
}

/** Organize runs that asked to apply their plan, the UI's `--apply`. Kept for this window only. */
const applyWhenReady = new Set<string>();

function applyIfAsked(job: Job) {
  const whole = !job.failed || job.failed < job.total; // a run where every file failed has no plan
  if (job.status === 'done' && job.plan_id && applyWhenReady.delete(job.id) && whole) {
    void act('apply_plan', { id: job.plan_id });
  }
}

/** Starts an organize job. A refusal, such as no key, throws for the form to show. */
export async function organize(input: ToolMap['organize'][0], apply: boolean) {
  const job = await call('organize', input);
  if (apply) applyWhenReady.add(job.id);
  // A short run can end before this answer arrives, with its last event already seen.
  const seen = queryClient.getQueryData<Status>(['status', {}])?.jobs.find((j) => j.id === job.id);
  applyIfAsked(seen ?? job);
  void queryClient.invalidateQueries({ queryKey: ['status'] });
  return job;
}

/** Scans the library that holds `folder`, or every library. `scan` takes only a library's root. */
export async function scanFolder(folder?: string) {
  const libraries = await call('list_libraries', {});
  const holds = (root: string) =>
    folder === root ||
    folder?.startsWith(root.endsWith(pathSep(root)) ? root : root + pathSep(root));
  return act('scan', { path: libraries.find((l) => holds(l.path))?.path });
}

const ended: Record<Job['kind'], (job: Job) => string> = {
  scan: (job) => t('Scan finished: {count} files', { count: job.scan?.files ?? job.done }),
  organize: (job) =>
    job.plan_id
      ? t('Organized {count} files. Its plan is ready', { count: job.done })
      : t('Organized {count} files', { count: job.done }),
  apply: (job) => t('Plan applied to {count} files', { count: job.done }),
  undo: (job) => t('Plan undone on {count} files', { count: job.done }),
};

const invalidate = (...tools: ToolName[]) =>
  tools.forEach((tool) => void queryClient.invalidateQueries({ queryKey: [tool] }));

function onEvent(event: ServerEvent) {
  if (event.type === 'job') {
    const { job } = event;
    queryClient.setQueryData<Status>(
      ['status', {}],
      (status) =>
        status && { ...status, jobs: [job, ...status.jobs.filter((j) => j.id !== job.id)] },
    );
    if (job.status === 'running') return;
    invalidate(...JOB_READS);
    applyIfAsked(job);
    if (job.status === 'done') notify(ended[job.kind](job));
    if (job.status === 'failed')
      notify(job.error ?? t('The {kind} job failed', { kind: t(job.kind) }), true);
  } else if (event.type === 'files') {
    invalidate('search_files', 'list_folders', 'list_tags', 'similar_files', 'status');
    const ids = new Set(event.ids);
    void queryClient.invalidateQueries({
      queryKey: ['get_file'],
      predicate: (q) => ids.has((q.queryKey[1] as { id: number }).id),
    });
  } else {
    queryClient.setQueryData<Status>(['status', {}], (s) => s && { ...s, reviews: event.count });
    invalidate('list_reviews');
  }
}

/** Keeps queries in step with `/api/events` while the app is mounted. */
export function useEvents() {
  useEffect(() => {
    if (mock) return mock.subscribe(onEvent);
    const source = new EventSource('/api/events');
    source.addEventListener('message', (e) => onEvent(JSON.parse(e.data as string) as ServerEvent));
    return () => source.close();
  }, []);
}

/** Thumbnail URL. `v` busts the immutable cache when the file changes. */
export const thumbUrl = (file: Pick<FileRow, 'id' | 'mtime_ms'>, size: 256 | 1024 = 256) =>
  mock?.thumb(file.id, size) ?? `/thumb/${file.id}?size=${size}&v=${file.mtime_ms}`;

export const fileUrl = (id: number) => mock?.fileUrl(id) ?? `/file/${id}`;

/** Streams `/api/chat` through the mock in dev. Undefined means the real `fetch`. */
export const chatFetch = mock?.chatFetch;
