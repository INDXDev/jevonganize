/** The UI's only door to the server: tool calls, events, and file URLs. */
import { QueryClient, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { FileRow, ServerEvent, Status, ToolMap, ToolName } from '../types.ts';
import { notify } from './tabs.ts';

// The condition folds to false in a production build, which drops the mock from the bundle.
const mock = import.meta.env.VITE_MOCK === '1' ? await import('./dev/mock.ts') : null;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
});

/** Runs one tool on the server. Throws an `Error` with the server's message when it refuses. */
export async function call<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
): Promise<ToolMap[K][1]> {
  if (mock) return mock.call(tool, input);
  const res = await fetch(`/api/call/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok: true; data: ToolMap[K][1] }
    | { ok: false; error: string }
    | null;
  if (!body) throw new Error(`Server error ${res.status}`);
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

/** A write from a button or key: refreshes what is on screen, and reports failure in the status bar. */
export async function act<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
): Promise<ToolMap[K][1] | undefined> {
  try {
    const data = await call(tool, input);
    void queryClient.invalidateQueries();
    return data;
  } catch (error) {
    notify((error as Error).message, true);
    return undefined;
  }
}

/** A direct tag edit by a person: the change is its own approval, so it applies at once. */
export async function editTags(fileId: number, change: { add?: string[]; remove?: string[] }) {
  const title = `Edit tags on file ${fileId}`;
  const plan = await act('propose_changes', { file_ids: [fileId], ...change, title });
  if (plan) await act('apply_plan', { id: plan.id });
}

/** Settles review items. Accepting builds a plan, and the key press is its approval. */
export async function resolveReviews(ids: number[], accept: boolean) {
  const plan = await act('resolve_reviews', { ids, accept });
  if (plan?.status === 'proposed') await act('apply_plan', { id: plan.id });
}

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
    if (job.status !== 'running') invalidate('status', 'list_plans', 'list_libraries');
  } else if (event.type === 'files') {
    invalidate('search_files', 'list_tags', 'similar_files', 'status');
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
