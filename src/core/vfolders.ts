/**
 * Virtual folders: saved, named rules over tags that exist only in the index. A folder's files are
 * whatever its rule matches, through the same `FileQuery` SQL as search, so there is no second
 * engine. A child narrows its parent: its effective rule is its own AND every ancestor's, so a
 * folder is always read with its `chain`, the folders from the root down to it.
 *
 * Saving is in vfolder-save.ts, and the folders generated from tags in vfolder-generated.ts. See
 * docs/concepts.md#virtual-folders.
 */
import { sep } from 'node:path';
import { z } from 'zod';
import type {
  FileQuery,
  FolderRule,
  Plan,
  VirtualFolder,
  VirtualFolderNode,
  VirtualFolderTree,
} from '../types.ts';
import { UserError } from './config.ts';
import type { Db, VirtualFolderRow } from './db.ts';
import { proposeChanges } from './plans.ts';
import { generatedQuery, generatedTree } from './vfolder-generated.ts';

/** How deep folders may nest, counting the root. */
export const MAX_DEPTH = 8;
const MAX_RULE_TAGS = 32;

/** Saved folders by id. */
export type FolderMap = Map<number, VirtualFolder>;

const ruleTags = z.array(z.string().min(1)).max(MAX_RULE_TAGS);

/** A rule as stored. Checked on every write and every read. */
export const ruleSchema = z.strictObject({
  tags: ruleTags,
  tag_match: z.enum(['any', 'all']),
  exclude_tags: ruleTags,
  folder: z.string().min(1).optional(),
});

/** What `list_vfolders` returns. */
export function folderTree(db: Db, generated = false): VirtualFolderTree {
  return { saved: savedTree(db), generated: generated ? generatedTree(db) : [] };
}

/** The saved tree, with counts from the search total cache. */
function savedTree(db: Db): VirtualFolderNode[] {
  const folders = loadFolders(db);
  const nodesUnder = (parent: number | null, ancestors: VirtualFolder[]): VirtualFolderNode[] =>
    childrenOf(folders, parent).map((folder) => {
      const chain = [...ancestors, folder];
      return {
        key: String(folder.id),
        name: folder.name,
        folder,
        count: db.countFiles(effectiveQuery(chain)),
        children: chain.length < MAX_DEPTH ? nodesUnder(folder.id, chain) : [],
      };
    });
  return nodesUnder(null, []);
}

/** The query of a saved folder by id, or of a generated one by key. */
export function folderQuery(db: Db, ref: { id?: number; generated?: string }): FileQuery {
  const { id, generated } = ref;
  if ((id === undefined) === (generated === undefined)) {
    throw new UserError('Give either an id or a generated key');
  }
  if (generated !== undefined) return generatedQuery(generated);
  return effectiveQuery(requireChain(db, id!));
}

/** The `FileQuery` of a folder: its rule AND every ancestor's. */
export function effectiveQuery(chain: VirtualFolder[]): FileQuery {
  const groups = chain
    .filter(({ rule }) => rule.tags.length > 0)
    .map(({ rule }) => ({ tags: rule.tags, tag_match: rule.tag_match }));
  const excluded = [...new Set(chain.flatMap(({ rule }) => rule.exclude_tags))];
  // `save` keeps every scope inside its ancestors', so the deepest one is the narrowest.
  const folder = innermostScope(chain);
  return {
    ...(folder && { folder }),
    ...(groups.length && { tag_groups: groups }),
    ...(excluded.length && { exclude_tags: excluded }),
  };
}

/** Deletes a folder and the folders under it. Files and their tags stay as they are. */
export function deleteFolder(db: Db, id: number): void {
  if (!db.deleteVfolder(id)) throw new UserError(`There is no virtual folder ${id}`);
}

/**
 * Plans the tags that put files in a folder: its home tag, and the home tag of every ancestor that
 * has one, so the file also passes the rules above it.
 */
export function proposeAdd(db: Db, id: number, fileIds: number[], source: Plan['source']): Plan {
  const chain = requireChain(db, id);
  const folder = chain.at(-1)!;
  if (!folder.tag) {
    throw new UserError(`${folder.name} has no home tag, so files cannot be put in it`);
  }
  const homeTags = chain.flatMap((entry) => (entry.tag ? [entry.tag] : []));
  const title = `Add to folder ${folder.name}`;
  return proposeChanges(db, { file_ids: fileIds, add: homeTags, title }, source);
}

/** Plans removing a folder's home tag. A file the rule still matches through another tag stays. */
export function proposeRemove(db: Db, id: number, fileIds: number[], source: Plan['source']): Plan {
  const folder = requireChain(db, id).at(-1)!;
  if (!folder.tag) throw new UserError(`${folder.name} has no home tag to remove`);
  const title = `Remove from folder ${folder.name}`;
  return proposeChanges(db, { file_ids: fileIds, remove: [folder.tag], title }, source);
}

/** Every folder whose row is sound, by id. A damaged one is left out with everything under it. */
export function loadFolders(db: Db): FolderMap {
  const folders: FolderMap = new Map();
  for (const row of db.listVfolders()) {
    const folder = toFolder(row);
    if (folder) folders.set(folder.id, folder);
  }
  return folders;
}

/** A stored row as a folder, or null when its rule is damaged. */
export function toFolder(row: VirtualFolderRow): VirtualFolder | null {
  const rule = parseRule(row.rule);
  return rule && { ...row, rule };
}

/** The rule a stored row holds, or null when the row is damaged. */
function parseRule(text: string): FolderRule | null {
  try {
    const parsed = ruleSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The folders directly under `parent`, or at the root for null. */
export const childrenOf = (folders: FolderMap, parent: number | null) =>
  [...folders.values()].filter((folder) => folder.parent === parent);

/** A saved folder and its ancestors, root first, or a `UserError`. */
function requireChain(db: Db, id: number): VirtualFolder[] {
  if (!db.getVfolder(id)) throw new UserError(`There is no virtual folder ${id}`);
  const chain = chainIn(loadFolders(db), id);
  if (!chain) {
    throw new UserError(`Virtual folder ${id} has a damaged rule. Delete it and save it again`);
  }
  return chain;
}

/** A folder and its ancestors, root first. Null when one is missing or damaged. */
export function chainIn(folders: FolderMap, id: number): VirtualFolder[] | null {
  const chain: VirtualFolder[] = [];
  for (let at: number | null = id; at !== null; at = chain[0]!.parent) {
    const folder = folders.get(at);
    if (!folder || chain.length >= MAX_DEPTH) return null; // `save` refuses cycles; this is a backstop
    chain.unshift(folder);
  }
  return chain;
}

/** True when `path` is `folder` itself or anywhere below it. */
export const isInside = (path: string, folder: string) =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

/** The narrowest folder scope among these folders, or undefined when none has one. */
export const innermostScope = (chain: VirtualFolder[]) =>
  chain.findLast(({ rule }) => rule.folder)?.rule.folder;
