/** The mock's libraries and the folders on its fictional disk. */
import type { ToolMap } from '../../tool-map.ts';
import { DAY, files, HOME, LIBS, NOW } from './mock-files.ts';
import { facetOf } from './mock-search.ts';

/** `?onboarding` starts the mock as a fresh install: no libraries and no key. */
export const emptyStart = new URLSearchParams(location.search).has('onboarding');

let libraries = emptyStart ? [] : LIBS;

/** Stands in for `list_libraries`. */
export const listLibraries = () =>
  libraries.map((path) => ({
    path,
    files: files.filter((file) => file.path.startsWith(path)).length,
    taggable: !path.endsWith('Downloads'),
    scanned_at: NOW - DAY,
  }));

/** Stands in for `add_library`. */
export function addLibrary({ path }: { path: string }) {
  libraries = [...new Set([...libraries, path])];
  return listLibraries().find((library) => library.path === path)!;
}

/** Stands in for `remove_library`. */
export function removeLibrary({ path }: { path: string }) {
  libraries = libraries.filter((library) => library !== path);
}

/** The subfolders the fictional disk has: a few under home, and a few under Documents. */
function subfoldersOf(path: string) {
  if (path === HOME) return ['Documents', 'Downloads', 'Pictures'];
  if (path.endsWith('Documents')) return ['Finance', 'Notes', 'Projects'];
  return [];
}

/** Stands in for `browse_dirs`. Every folder also holds one file and one dot file. */
export function browseDirs({ path = HOME }: ToolMap['browse_dirs'][0]): ToolMap['browse_dirs'][1] {
  const folders = subfoldersOf(path).map((name, i) => ({
    name,
    dir: true,
    size: 96,
    modified: Date.UTC(2026, 5 - i, 3),
  }));
  return {
    path,
    parent: path === HOME ? null : path.slice(0, path.lastIndexOf('/')),
    places: [HOME, `${HOME}/Documents`, `${HOME}/Downloads`, `${HOME}/Pictures`],
    entries: [
      ...folders,
      { name: 'invoice-44.pdf', dir: false, size: 48_210, modified: Date.UTC(2026, 3, 9) },
      { name: '.DS_Store', dir: false, size: 6148, modified: Date.UTC(2026, 1, 2) },
    ],
  };
}

/** Stands in for `list_tags`: each tag in `folder`, or everywhere, most used first. */
export function listTags({ folder }: ToolMap['list_tags'][0]) {
  const counts = new Map<string, number>();
  const inScope = files.filter((file) => !folder || file.path.startsWith(folder));
  for (const file of inScope)
    for (const tag of file.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, facet: facetOf(tag), count }))
    .toSorted((a, b) => b.count - a.count);
}

/** Stands in for `list_folders`: the folders directly in `folder` that hold a file. */
export function listFolders({ folder }: ToolMap['list_folders'][0]) {
  const below = files.filter((file) => file.path.startsWith(`${folder}/`));
  const relativeParts = below.map((file) => file.path.slice(folder.length + 1).split('/'));
  const childNames = relativeParts.filter((parts) => parts.length > 1).map((parts) => parts[0]!);
  return [...new Set(childNames)].map((name) => ({
    name,
    path: `${folder}/${name}`,
    files: below.filter((file) => file.path.startsWith(`${folder}/${name}/`)).length,
  }));
}
