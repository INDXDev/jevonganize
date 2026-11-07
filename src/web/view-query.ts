import { t } from './i18n/index.ts';
/** The URL query is the whole state of a view. This module reads and writes it. */
import type { ViewOptions } from '../core/config.ts';
import type { FileQuery, FileRow } from '../types.ts';

/** Every screen, in the order of the rail. `key` follows `g` to go there. */
export const SCREENS = [
  { id: 'browse', title: 'Files', key: 'b' },
  { id: 'organize', title: 'Organize', key: 'o' },
  { id: 'review', title: 'Review', key: 'r' },
  { id: 'tags', title: 'Tags', key: 't' },
  { id: 'names', title: 'Names', key: 'n' },
  { id: 'facets', title: 'Facets', key: 'f' },
  { id: 'activity', title: 'Activity', key: 'a' },
  { id: 'settings', title: 'Settings', key: 's' },
] as const;

export type Screen = (typeof SCREENS)[number]['id'];

const screenTitle = (screen: Screen) => t(SCREENS.find((s) => s.id === screen)!.title);

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
  /** The open virtual folder: a saved folder's id, or a generated folder's key. */
  vfolder?: string;
  /** Its name, for the tab title. */
  vname?: string;
};

export function parseView(query: string): View {
  const p = new URLSearchParams(query);
  const get = (key: string) => p.get(key) ?? undefined;
  const file = Number(p.get('file'));
  const screen = SCREENS.find((s) => s.id === p.get('screen'))?.id ?? 'browse';
  const status = get('status');
  return {
    screen,
    folder: get('folder'),
    text: get('text'),
    mime: get('mime'),
    status: status === 'new' || status === 'organized' || status === 'failed' ? status : undefined,
    sort: get('sort') as View['sort'],
    order: get('order') as View['order'],
    tag: p.getAll('tag'),
    match: p.get('match') === 'all' ? 'all' : 'any',
    not: p.getAll('not'),
    view: p.get('view') === 'list' ? 'list' : 'grid',
    file: file || undefined,
    facet: get('facet'),
    section: get('section'),
    vfolder: get('vfolder'),
    vname: get('vname'),
  };
}

export type Patch = { [K in keyof View]?: View[K] | null };

/** Applies a patch to a query string. `undefined`, `null` and `[]` clear a param. */
export function patchQuery(query: string, patch: Patch): string {
  const p = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    p.delete(key);
    for (const v of [value].flat()) if (v !== undefined && v !== null) p.append(key, String(v));
  }
  if (p.get('screen') === 'browse') p.delete('screen');
  if (p.get('view') === 'grid') p.delete('view');
  if (p.get('match') === 'any') p.delete('match');
  return p.toString();
}

type Scope = Pick<ViewOptions, 'show_dotfiles' | 'include_subfolders'>;

/** The files a view shows, which is also what Organize and chat act on. */
export function toFileQuery(v: View, options: Scope): FileQuery {
  // As in a file manager, a search or a tag looks through the whole folder.
  const direct = !options.include_subfolders && v.folder && !v.text && !v.tag.length;
  return {
    text: v.text,
    folder: v.folder,
    tags: v.tag.length ? v.tag : undefined,
    tag_match: v.tag.length > 1 ? v.match : undefined,
    exclude_tags: v.not.length ? v.not : undefined,
    mime: v.mime,
    status: v.status,
    hide_dotfiles: options.show_dotfiles ? undefined : true,
    direct_only: direct ? true : undefined,
    sort: v.sort,
    order: v.order,
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

/** The screen's name, else the first tag, else the last folder segment. */
export function titleOf(query: string): string {
  const v = parseView(query);
  if (v.screen !== 'browse') return screenTitle(v.screen);
  if (v.vfolder) return v.vname ?? v.vfolder;
  return v.tag[0] ?? (v.folder ? lastSegment(v.folder) : t('All files'));
}
