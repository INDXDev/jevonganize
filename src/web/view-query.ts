/** The URL query is the whole state of a view. This module reads and writes it. */
import type { FileQuery, FileRow } from '../types.ts';

export type Screen = 'browse' | 'review' | 'facets' | 'settings' | 'activity';

export type View = {
  screen: Screen;
  folder?: string;
  text?: string;
  mime?: string;
  status?: FileRow['status'];
  sort?: NonNullable<FileQuery['sort']>;
  order?: NonNullable<FileQuery['order']>;
  tag: string[];
  not: string[];
  view: 'grid' | 'list';
  file?: number;
  facet?: string;
  section?: string;
};

export function parseView(query: string): View {
  const p = new URLSearchParams(query);
  const get = (key: string) => p.get(key) ?? undefined;
  const file = Number(p.get('file'));
  return {
    screen: (get('screen') ?? 'browse') as Screen,
    folder: get('folder'),
    text: get('text'),
    mime: get('mime'),
    status: get('status') as View['status'],
    sort: get('sort') as View['sort'],
    order: get('order') as View['order'],
    tag: p.getAll('tag'),
    not: p.getAll('not'),
    view: p.get('view') === 'list' ? 'list' : 'grid',
    file: file || undefined,
    facet: get('facet'),
    section: get('section'),
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
  return p.toString();
}

export function toFileQuery(v: View): FileQuery {
  return {
    text: v.text,
    folder: v.folder,
    tags: v.tag.length ? v.tag : undefined,
    exclude_tags: v.not.length ? v.not : undefined,
    mime: v.mime,
    status: v.status,
    sort: v.sort,
    order: v.order,
  };
}

/** The separator of a path from the server, whatever OS the browser is on. */
export const pathSep = (path: string) => (path.startsWith('/') ? '/' : '\\');

function lastSegment(path: string) {
  return path.split(pathSep(path)).findLast(Boolean) ?? path;
}

/** The screen's name, else the first tag, else the last folder segment. */
export function titleOf(query: string): string {
  const v = parseView(query);
  if (v.screen !== 'browse') return v.screen[0]!.toUpperCase() + v.screen.slice(1);
  return v.tag[0] ?? (v.folder ? lastSegment(v.folder) : 'All files');
}
