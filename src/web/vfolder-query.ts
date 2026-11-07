/** A view inside a virtual folder: the folder's own query, narrowed by the view's filters. */
import type { ViewOptions } from '../core/config.ts';
import type { FileQuery } from '../types.ts';
import { queryClient, useTool } from './api.ts';
import { toFileQuery, type View } from './view-query.ts';

type Scope = Pick<ViewOptions, 'show_dotfiles' | 'include_subfolders'>;

/** What `vfolder_files` takes for a folder key: a saved folder's id, or a generated key. */
export const folderRef = (key: string) =>
  /^\d+$/.test(key) ? { id: Number(key) } : { generated: key };

/** The input the folder bar and every scope share, so they read one cached answer. */
export const folderInput = (key: string) => ({ ...folderRef(key), limit: 1 });

/** The view's own filters, ANDed with a folder's query. The folder's scope beats the view's. */
export function withFolder(base: FileQuery, folder: FileQuery): FileQuery {
  const groups = [
    ...(folder.tag_groups ?? []),
    ...(folder.tags?.length ? [{ tags: folder.tags, tag_match: folder.tag_match ?? 'all' }] : []),
  ];
  const excluded = [...(base.exclude_tags ?? []), ...(folder.exclude_tags ?? [])];
  return {
    ...base,
    folder: folder.folder ?? base.folder,
    direct_only: undefined,
    tag_groups: [...(base.tag_groups ?? []), ...groups],
    exclude_tags: excluded.length ? excluded : undefined,
  };
}

/** The files a view shows. Undefined while its folder's query is still on its way. */
export function useViewScope(view: View, options: Scope): FileQuery | undefined {
  const base = toFileQuery(view, options);
  const key = view.vfolder;
  const { data } = useTool('vfolder_files', folderInput(key ?? ''), { enabled: !!key });
  if (!key) return base;
  return data && withFolder(base, data.query);
}

/** The same, read from what is cached, for a callback. Without the folder loaded, no folder. */
export function scopeNow(view: View, options: Scope): FileQuery {
  const base = toFileQuery(view, options);
  if (!view.vfolder) return base;
  const cached = queryClient.getQueryData<{ query: FileQuery }>([
    'vfolder_files',
    folderInput(view.vfolder),
  ]);
  return cached ? withFolder(base, cached.query) : base;
}
