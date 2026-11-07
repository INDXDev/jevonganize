/** The UI's only door to the server: tool calls, cached reads, and file URLs. Events are in events.ts. */
import { t } from './i18n/index.ts';
import { QueryClient, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { ViewOptions } from '../core/config.ts';
import type { FileRow, Job, Status } from '../types.ts';
import type { ToolMap, ToolName } from '../tool-map.ts';
import { notify } from './tabs.ts';
import type { TagColors } from './tag-colors.ts';
import { refreshedBy } from './refresh.ts';
import { pathSep } from './view-query.ts';

/** The dev mock server, or null for the real one. */
// The condition folds to false in a production build, which drops the mock from the bundle.
export const mock = import.meta.env.VITE_MOCK === '1' ? await import('./dev/mock.ts') : null;

/** The one query cache of the window. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
});

const CONFIG_KEY = ['get_config', {}];
/** The cache key of `status`, which events patch in place. */
export const STATUS_KEY = ['status', {}];

type LoadedConfig = ToolMap['get_config'][1];

const cachedStatus = () => queryClient.getQueryData<Status>(STATUS_KEY);

/** Marks these reads stale, so whatever shows them fetches again. */
export const invalidate = (...tools: ToolName[]) =>
  tools.forEach((tool) => void queryClient.invalidateQueries({ queryKey: [tool] }));

/** Runs one tool on the server. Throws an `Error` with the server's message when it refuses. */
export async function call<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
  signal?: AbortSignal,
): Promise<ToolMap[K][1]> {
  if (mock) return mock.call(tool, input);
  const response = await fetch(`/api/call/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  // A proxy or a crash can answer with something other than the server's JSON envelope.
  const envelope = (await response.json().catch(() => null)) as
    | { ok: true; data: ToolMap[K][1] }
    | { ok: false; error: string }
    | null;
  if (!envelope) throw new Error(t('Server error {status}', { status: response.status }));
  if (!envelope.ok) throw new Error(envelope.error);
  return envelope.data;
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
  const { data: loaded } = useTool('get_config', {}, { staleTime: Infinity });
  return loaded?.config.tag_colors as TagColors | undefined;
}

/** The `[view]` config. The shell waits for it, so views can rely on it. */
export const viewOptions = () =>
  queryClient.getQueryData<LoadedConfig>(CONFIG_KEY)?.config.view as ViewOptions;

/** The `[view]` config, as a hook that renders again when it changes. */
export function useViewOptions() {
  const { data: loaded } = useTool('get_config', {}, { staleTime: Infinity });
  return loaded?.config.view as ViewOptions;
}

/** Shows a change at once, without saving it: for a slider while it is being dragged. */
export const previewView = (change: Partial<ViewOptions>) =>
  queryClient.setQueryData<LoadedConfig>(CONFIG_KEY, (loaded) => {
    if (!loaded) return loaded;
    const view = { ...viewOptions(), ...change };
    return { ...loaded, config: { ...loaded.config, view } };
  });

/** The chain of view saves so far, so that each one starts after the one before. */
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
    const result = await call(tool, input);
    const reads = refreshedBy(tool);
    if (reads) invalidate(...reads);
    else void queryClient.invalidateQueries();
    return result;
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
const applyWhenDone = new Set<string>();

/** Applies a finished organize run's plan, once, if the run asked for that. */
export function applyPlanIfAsked(job: Job) {
  // A run where every file failed has no plan worth applying.
  const someFileSucceeded = !job.failed || job.failed < job.total;
  if (job.status !== 'done' || !job.plan_id) return;
  // `delete` also forgets the request, so a repeated event cannot apply the plan twice.
  if (applyWhenDone.delete(job.id) && someFileSucceeded)
    void act('apply_plan', { id: job.plan_id });
}

/** Asks the model which catalog topics fit a folder. Adds nothing. */
export async function chooseTopics(folder?: string): Promise<string[]> {
  const picks = await act('pick_topics', { query: { folder } });
  return picks?.topics.map((topic) => topic.value) ?? [];
}

/** Makes catalog topics values of `topic`. */
export async function addTopics(values: string[]) {
  for (const value of values) {
    await act('set_vocabulary', { facet: 'topic', value, state: 'active' });
  }
  notify(t('Added {count} topics', { count: values.length }));
}

/** Lets the model choose catalog topics for a folder, and adds them with no further step. */
export async function pickTopics(folder?: string) {
  await addTopics(await chooseTopics(folder));
}

/** Starts an organize job. A refusal, such as no key, throws for the form to show. */
export async function organize(input: ToolMap['organize'][0], apply: boolean) {
  const job = await call('organize', input);
  if (apply) applyWhenDone.add(job.id);
  // A short run can end before this answer arrives, with its last event already seen.
  const seen = cachedStatus()?.jobs.find((known) => known.id === job.id);
  applyPlanIfAsked(seen ?? job);
  void queryClient.invalidateQueries({ queryKey: ['status'] });
  return job;
}

/** Scans the library that holds `folder`, or every library. `scan` takes only a library's root. */
export async function scanFolder(folder?: string) {
  const libraries = await call('list_libraries', {});
  const holdsFolder = (root: string) => {
    const rootWithSeparator = root.endsWith(pathSep(root)) ? root : root + pathSep(root);
    return folder === root || folder?.startsWith(rootWithSeparator);
  };
  return act('scan', { path: libraries.find((library) => holdsFolder(library.path))?.path });
}

/** Thumbnail URL. `v` busts the immutable cache when the file changes. */
export const thumbUrl = (file: Pick<FileRow, 'id' | 'mtime_ms'>, size: 256 | 1024 = 256) =>
  mock?.thumb(file.id, size) ?? `/thumb/${file.id}?size=${size}&v=${file.mtime_ms}`;

/** The URL that serves a file's bytes, for previews. */
export const fileUrl = (id: number) => mock?.fileUrl(id) ?? `/file/${id}`;

/** Streams `/api/chat` through the mock in dev. Undefined means the real `fetch`. */
export const chatFetch = mock?.chatFetch;
