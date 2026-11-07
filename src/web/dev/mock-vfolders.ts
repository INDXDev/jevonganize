/** The mock's virtual folders: the same rules as `core/vfolders.ts`, kept simple. */
import type {
  FileQuery,
  ToolMap,
  VirtualFolder,
  VirtualFolderNode,
  VirtualFolderTree,
} from '../../types.ts';
import { propose } from './mock-plans.ts';
import { df, search } from './mock-search.ts';

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
let nextId = 3;

const chain = (id: number): VirtualFolder[] => {
  const folder = folders.find((entry) => entry.id === id);
  if (!folder) throw new Error(`There is no virtual folder ${id}`);
  return folder.parent === null ? [folder] : [...chain(folder.parent), folder];
};

const queryOf = (id: number): FileQuery => ({
  tag_groups: chain(id)
    .filter(({ rule }) => rule.tags.length)
    .map(({ rule }) => ({ tags: rule.tags, tag_match: rule.tag_match })),
  exclude_tags: chain(id).flatMap(({ rule }) => rule.exclude_tags),
});

const count = (query: FileQuery) => search({ ...query, limit: 1 }).total;

function saved(parent: number | null): VirtualFolderNode[] {
  return folders
    .filter((folder) => folder.parent === parent)
    .map((folder) => ({
      key: String(folder.id),
      name: folder.name,
      folder,
      count: count(queryOf(folder.id)),
      children: saved(folder.id),
    }));
}

function generated(): VirtualFolderNode[] {
  const byNamespace = Map.groupBy([...df()], ([tag]) => tag.split(':')[0]!);
  return [...byNamespace].map(([namespace, tags]) => ({
    key: `${namespace}:`,
    name: namespace,
    folder: null,
    count: count({ tags: tags.map(([tag]) => tag), tag_match: 'any' }),
    children: tags.map(([tag, n]) => ({
      key: tag,
      name: tag.slice(namespace.length + 1),
      folder: null,
      count: n,
      children: [],
    })),
  }));
}

/** Stands in for `list_vfolders`. */
export const listVfolders = ({ generated: withGenerated }: { generated?: boolean }) =>
  ({ saved: saved(null), generated: withGenerated ? generated() : [] }) satisfies VirtualFolderTree;

/** Stands in for `save_vfolder`. */
export function saveVfolder(input: ToolMap['save_vfolder'][0]): VirtualFolder {
  const rule = {
    tags: input.rule.tags ?? [],
    tag_match: input.rule.tag_match ?? 'all',
    exclude_tags: input.rule.exclude_tags ?? [],
  };
  const folder: VirtualFolder = {
    id: input.id ?? nextId++,
    name: input.name.trim(),
    parent: input.parent ?? null,
    rule,
    tag: input.tag === undefined ? (rule.tags.length === 1 ? rule.tags[0]! : null) : input.tag,
    created_at: Date.now(),
  };
  const at = folders.findIndex((entry) => entry.id === folder.id);
  if (at >= 0) folders[at] = folder;
  else folders.push(folder);
  return folder;
}

/** Stands in for `delete_vfolder`. */
export function deleteVfolder({ id }: { id: number }): void {
  for (const child of folders.filter((folder) => folder.parent === id)) deleteVfolder(child);
  folders.splice(
    folders.findIndex((folder) => folder.id === id),
    1,
  );
}

/** Stands in for `vfolder_files`. */
export function vfolderFiles(input: ToolMap['vfolder_files'][0]) {
  const { id, generated: key, ...page } = input;
  const query = key === undefined ? queryOf(id!) : { tags: [key] };
  return { ...search({ ...query, ...page }), query };
}

/** Stands in for `add_to_vfolder` and `remove_from_vfolder`. */
export function moveFiles({ id, file_ids }: { id: number; file_ids: number[] }, adding: boolean) {
  const path = chain(id);
  const own = path.at(-1)!;
  if (!own.tag) throw new Error(`${own.name} has no home tag`);
  const tags = adding ? path.flatMap((folder) => (folder.tag ? [folder.tag] : [])) : [own.tag];
  return propose({
    file_ids,
    ...(adding ? { add: tags } : { remove: tags }),
    title: `${adding ? 'Add to' : 'Remove from'} folder ${own.name}`,
  });
}
