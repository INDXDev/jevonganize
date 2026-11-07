/** The mock's virtual folders: the same rules as `core/vfolders.ts`, kept simple. */
import type {
  FileQuery,
  VirtualFolder,
  VirtualFolderNode,
  VirtualFolderTree,
} from '../../types.ts';
import type { ToolMap } from '../../tool-map.ts';
import { propose } from './mock-plans.ts';
import { countFilesPerTag, searchFiles } from './mock-search.ts';

const folders: VirtualFolder[] = [
  {
    id: 1,
    name: 'Taxes',
    parent: null,
    rule: { tags: ['topic:finance'], tag_match: 'all', exclude_tags: [] },
    tag: 'topic:finance',
    created_at: 0,
  },
  {
    id: 2,
    name: '2026',
    parent: 1,
    rule: { tags: ['doc-date:2026'], tag_match: 'all', exclude_tags: [] },
    tag: 'doc-date:2026',
    created_at: 0,
  },
];
let nextFolderId = 3;

/** A folder and every folder above it, the top one first. A nested folder narrows its parents. */
function withAncestors(id: number): VirtualFolder[] {
  const folder = folders.find((entry) => entry.id === id);
  if (!folder) throw new Error(`There is no virtual folder ${id}`);
  return folder.parent === null ? [folder] : [...withAncestors(folder.parent), folder];
}

/** The files a saved folder holds: every rule on its path must match. */
function folderQuery(id: number): FileQuery {
  const path = withAncestors(id);
  return {
    tag_groups: path
      .filter(({ rule }) => rule.tags.length)
      .map(({ rule }) => ({ tags: rule.tags, tag_match: rule.tag_match })),
    exclude_tags: path.flatMap(({ rule }) => rule.exclude_tags),
  };
}

const countMatches = (query: FileQuery) => searchFiles({ ...query, limit: 1 }).total;

function savedNodes(parent: number | null): VirtualFolderNode[] {
  return folders
    .filter((folder) => folder.parent === parent)
    .map((folder) => ({
      key: String(folder.id),
      name: folder.name,
      folder,
      count: countMatches(folderQuery(folder.id)),
      children: savedNodes(folder.id),
    }));
}

/** One folder per tag namespace, holding one folder per tag in it. */
function generatedNodes(): VirtualFolderNode[] {
  const tagsByNamespace = Map.groupBy([...countFilesPerTag()], ([tag]) => tag.split(':')[0]!);
  return [...tagsByNamespace].map(([namespace, tagCounts]) => ({
    key: `${namespace}:`,
    name: namespace,
    folder: null,
    count: countMatches({ tags: tagCounts.map(([tag]) => tag), tag_match: 'any' }),
    children: tagCounts.map(([tag, count]) => ({
      key: tag,
      name: tag.slice(namespace.length + 1),
      folder: null,
      count,
      children: [],
    })),
  }));
}

/** Stands in for `list_vfolders`. */
export const listVfolders = ({ generated }: { generated?: boolean }) =>
  ({
    saved: savedNodes(null),
    generated: generated ? generatedNodes() : [],
  }) satisfies VirtualFolderTree;

/** Stands in for `save_vfolder`. A folder with one tag in its rule takes that tag as its home. */
export function saveVfolder(input: ToolMap['save_vfolder'][0]): VirtualFolder {
  const rule = {
    tags: input.rule.tags ?? [],
    tag_match: input.rule.tag_match ?? 'all',
    exclude_tags: input.rule.exclude_tags ?? [],
  };
  const defaultTag = rule.tags.length === 1 ? rule.tags[0]! : null;
  const folder: VirtualFolder = {
    id: input.id ?? nextFolderId++,
    name: input.name.trim(),
    parent: input.parent ?? null,
    rule,
    tag: input.tag === undefined ? defaultTag : input.tag,
    created_at: Date.now(),
  };
  const existingIndex = folders.findIndex((entry) => entry.id === folder.id);
  if (existingIndex >= 0) folders[existingIndex] = folder;
  else folders.push(folder);
  return folder;
}

/** Stands in for `delete_vfolder`, which takes the folders inside it too. */
export function deleteVfolder({ id }: { id: number }): void {
  for (const child of folders.filter((folder) => folder.parent === id)) deleteVfolder(child);
  folders.splice(
    folders.findIndex((folder) => folder.id === id),
    1,
  );
}

/** Stands in for `vfolder_files`: a saved folder by `id`, or a generated one by its tag. */
export function vfolderFiles(input: ToolMap['vfolder_files'][0]) {
  const { id, generated: generatedTag, ...page } = input;
  const query = generatedTag === undefined ? folderQuery(id!) : { tags: [generatedTag] };
  return { ...searchFiles({ ...query, ...page }), query };
}

/**
 * Stands in for `add_to_vfolder` and `remove_from_vfolder`. Adding gives the home tags of the
 * folder and the folders above it. Removing takes only the folder's own.
 */
export function moveFiles({ id, file_ids }: { id: number; file_ids: number[] }, adding: boolean) {
  const path = withAncestors(id);
  const folder = path.at(-1)!;
  if (!folder.tag) throw new Error(`${folder.name} has no home tag`);
  const homeTags = path.flatMap((entry) => (entry.tag ? [entry.tag] : []));
  const tags = adding ? homeTags : [folder.tag];
  return propose({
    file_ids,
    ...(adding ? { add: tags } : { remove: tags }),
    title: `${adding ? 'Add to' : 'Remove from'} folder ${folder.name}`,
  });
}
