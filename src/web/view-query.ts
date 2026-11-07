/** The URL query is the whole state of a view. This module reads and writes it. */
import { t } from './i18n/index.ts';
import type { ViewOptions } from '../core/config.ts';
import type { FileQuery, FileRow } from '../types.ts';
import { SCREENS, upgradeAddress, type Screen } from './screens.ts';

/** A rail screen's translated name. */
const screenTitle = (screen: Screen) => t(SCREENS.find((s) => s.id === screen)!.title);

/** A view as the query describes it, with every default filled in. */
export type View = {
  screen: Screen;
  folder?: string;
  text?: string;
  mime?: string;
  status?: FileRow['status'];
  sort?: NonNullable<FileQuery['sort']>;
  order?: NonNullable<FileQuery['order']>;
  tag: string[];
  /** Whether a file needs any of `tag` or all of them. */
  match: NonNullable<FileQuery['tag_match']>;
  not: string[];
  view: 'grid' | 'list';
  file?: number;
  facet?: string;
  section?: string;
  /** On the Dashboard: how many days its usage covers. */
  period?: string;
  /** On the Dashboard: the plan status its history shows. */
  plans?: string;
  /** The open virtual folder: a saved folder's id, or a generated folder's key. */
  vfolder?: string;
  /** Its name, for the tab title. */
  vname?: string;
  /** On Folders: a tag to open the New folder dialog with, as Tags' "Make a folder" asks. */
  newfolder?: string;
};

const isFileStatus = (value?: string): value is FileRow['status'] =>
  value === 'new' || value === 'organized' || value === 'failed';

/** Reads a query string. A value it does not know falls back to the default. */
export function parseView(query: string): View {
  const params = new URLSearchParams(query);
  upgradeAddress(params);
  const optional = (key: string) => params.get(key) ?? undefined;
  const file = Number(params.get('file'));
  const screen = SCREENS.find((s) => s.id === params.get('screen'))?.id ?? 'browse';
  const status = optional('status');
  return {
    screen,
    folder: optional('folder'),
    text: optional('text'),
    mime: optional('mime'),
    status: isFileStatus(status) ? status : undefined,
    sort: optional('sort') as View['sort'],
    order: optional('order') as View['order'],
    tag: params.getAll('tag'),
    match: params.get('match') === 'all' ? 'all' : 'any',
    not: params.getAll('not'),
    view: params.get('view') === 'list' ? 'list' : 'grid',
    file: file || undefined,
    facet: optional('facet'),
    section: optional('section'),
    period: optional('period'),
    plans: optional('plans'),
    vfolder: optional('vfolder'),
    vname: optional('vname'),
    newfolder: optional('newfolder'),
  };
}

/** A change to a view. `null` clears a field. */
export type Patch = { [K in keyof View]?: View[K] | null };

// Defaults stay out of the URL, so one view always has one address.
const DEFAULT_PARAMS: Record<string, string> = { screen: 'browse', view: 'grid', match: 'any' };

/** Applies a patch to a query string. `undefined`, `null` and `[]` clear a param. */
export function patchQuery(query: string, patch: Patch): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    params.delete(key);
    const items = [value].flat().filter((item) => item !== undefined && item !== null);
    for (const item of items) params.append(key, String(item));
  }
  upgradeAddress(params);
  for (const [key, fallback] of Object.entries(DEFAULT_PARAMS))
    if (params.get(key) === fallback) params.delete(key);
  return params.toString();
}

/** A list, or undefined when it is empty, so an empty filter is left out of the query. */
const unlessEmpty = <T>(list: T[]) => (list.length ? list : undefined);

type Scope = Pick<ViewOptions, 'show_dotfiles' | 'include_subfolders'>;

/** The files a view shows, which is also what Organize and chat act on. */
export function toFileQuery(view: View, options: Scope): FileQuery {
  // As in a file manager, a search or a tag looks through the whole folder.
  const searchesWholeFolder = !!view.text || view.tag.length > 0;
  const directOnly = !options.include_subfolders && view.folder && !searchesWholeFolder;
  return {
    text: view.text,
    folder: view.folder,
    tags: unlessEmpty(view.tag),
    tag_match: view.tag.length > 1 ? view.match : undefined,
    exclude_tags: unlessEmpty(view.not),
    mime: view.mime,
    status: view.status,
    hide_dotfiles: options.show_dotfiles ? undefined : true,
    direct_only: directOnly ? true : undefined,
    sort: view.sort,
    order: view.order,
  };
}

/** The sort a query really gets, with the same defaults as the index. */
export function sortOf(query: FileQuery) {
  const sort = query.sort ?? (query.text?.trim() ? 'relevance' : 'name');
  const ascending = sort === 'name' || sort === 'kind';
  return { sort, order: query.order ?? (ascending ? 'asc' : 'desc') };
}

/** The separator of a path from the server, whatever OS the browser is on. */
export const pathSep = (path: string) => (path.startsWith('/') ? '/' : '\\');

/** The last folder or file name in a path. */
export function lastSegment(path: string) {
  return path.split(pathSep(path)).findLast(Boolean) ?? path;
}

/** The screen's name, else the open virtual folder, else the first tag, else the last folder segment. */
export function titleOf(query: string): string {
  const view = parseView(query);
  if (view.screen !== 'browse') return screenTitle(view.screen);
  if (view.vfolder) return view.vname ?? view.vfolder;
  if (view.tag[0] !== undefined) return view.tag[0];
  return view.folder ? lastSegment(view.folder) : t('All files');
}
