/**
 * Virtual folders: saved, named rules over tags that exist only in the index. A folder's files are
 * whatever its rule matches, through the same `FileQuery` SQL as search, so there is no second
 * engine. A child narrows its parent: its effective rule is its own AND every ancestor's. Generated
 * folders, one per tag namespace and hierarchical value, are computed and never stored. See
 * docs/concepts.md#virtual-folders.
 */
import { sep } from 'node:path';
import { z } from 'zod';
import type {
  FileQuery,
  FolderRule,
  Plan,
  SaveVirtualFolder,
  Tag,
  VirtualFolder,
  VirtualFolderNode,
  VirtualFolderTree,
} from '../types.ts';
import { indexedPath, UserError } from './config.ts';
import type { Db, VirtualFolderRow } from './db.ts';
import { proposeChanges } from './plans.ts';
import { validTags } from './tags.ts';

/** How deep folders may nest, counting the root. */
export const MAX_DEPTH = 8;
const MAX_NAME = 120;
const MAX_RULE_TAGS = 32;
const CONTROL = /\p{Cc}/u;
const YEAR_TAG = /^[^:]*:\d{4}$/;
const MONTH_TAG = /^([^:]*:\d{4})-\d{2}$/;

const ruleTags = z.array(z.string().min(1)).max(MAX_RULE_TAGS);

/** A rule as stored. Checked on every write and every read. */
export const ruleSchema = z.strictObject({
  tags: ruleTags,
  tag_match: z.enum(['any', 'all']),
  exclude_tags: ruleTags,
  folder: z.string().min(1).optional(),
});

/** The rule a stored row holds, or null when the row is damaged. */
function parseRule(text: string): FolderRule | null {
  try {
    const parsed = ruleSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const toFolder = (row: VirtualFolderRow): VirtualFolder | null => {
  const rule = parseRule(row.rule);
  return rule && { ...row, rule };
};

/** Every folder whose row is sound, by id. A damaged one is left out with everything under it. */
function loadFolders(db: Db): Map<number, VirtualFolder> {
  const folders = new Map<number, VirtualFolder>();
  for (const row of db.listVfolders()) {
    const folder = toFolder(row);
    if (folder) folders.set(folder.id, folder);
  }
  return folders;
}

/** A folder and its ancestors, root first. Null when one is missing or damaged. */
function chainIn(folders: Map<number, VirtualFolder>, id: number): VirtualFolder[] | null {
  const chain: VirtualFolder[] = [];
  for (let at: number | null = id; at !== null; at = chain[0]!.parent) {
    const folder = folders.get(at);
    if (!folder || chain.length >= MAX_DEPTH) return null; // `save` refuses cycles; this is a backstop
    chain.unshift(folder);
  }
  return chain;
}

/** A saved folder and its ancestors, root first, or a `UserError`. */
function requireChain(db: Db, id: number): VirtualFolder[] {
  if (!db.getVfolder(id)) throw new UserError(`There is no virtual folder ${id}`);
  const chain = chainIn(loadFolders(db), id);
  if (!chain)
    throw new UserError(`Virtual folder ${id} has a damaged rule. Delete it and save it again`);
  return chain;
}

const inside = (path: string, folder: string) =>
  path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

/** The `FileQuery` of a folder: its rule AND every ancestor's. */
export function effectiveQuery(chain: VirtualFolder[]): FileQuery {
  const groups = chain
    .filter(({ rule }) => rule.tags.length > 0)
    .map(({ rule }) => ({ tags: rule.tags, tag_match: rule.tag_match }));
  const excluded = [...new Set(chain.flatMap(({ rule }) => rule.exclude_tags))];
  // `save` keeps every scope inside its ancestors', so the deepest one is the narrowest.
  const folder = chain.findLast(({ rule }) => rule.folder)?.rule.folder;
  return {
    ...(folder && { folder }),
    ...(groups.length && { tag_groups: groups }),
    ...(excluded.length && { exclude_tags: excluded }),
  };
}

/** The `FileQuery` of a generated folder, by its key: a tag, or `<namespace>:`. */
export const generatedQuery = (key: string): FileQuery => ({ tags: [key] });

/** The query of a saved folder by id, or of a generated one by key. */
export function folderQuery(db: Db, ref: { id?: number; generated?: string }): FileQuery {
  if ((ref.id === undefined) === (ref.generated === undefined)) {
    throw new UserError('Give either an id or a generated key');
  }
  if (ref.generated !== undefined) return generatedQuery(ref.generated);
  return effectiveQuery(requireChain(db, ref.id!));
}

/** A folder's own home tag: the one tag of a single-tag rule, unless it names a whole namespace. */
function defaultTag(rule: FolderRule): Tag | null {
  const [only] = rule.tags;
  return rule.tags.length === 1 && only !== undefined && !only.endsWith(':') ? only : null;
}

function homeTag(tag: Tag): Tag {
  const [clean] = validTags([tag]);
  if (!clean || clean.endsWith(':'))
    throw new UserError(`${JSON.stringify(tag)} cannot be a home tag`);
  return clean;
}

function cleanName(name: string): string {
  const clean = name.normalize('NFC').trim();
  if (!clean) throw new UserError('A virtual folder needs a name');
  if (clean.length > MAX_NAME)
    throw new UserError(`A folder name is at most ${MAX_NAME} characters`);
  if (CONTROL.test(clean)) throw new UserError('A folder name cannot contain control characters');
  return clean;
}

/** The scope of a rule, as an indexed path inside a library. */
function cleanScope(db: Db, folder: string): string {
  const path = indexedPath(folder);
  if (!db.libraryPaths().some((library) => inside(path, library))) {
    throw new UserError(`${path} is not in a library`);
  }
  return path;
}

function cleanRule(db: Db, rule: SaveVirtualFolder['rule']): FolderRule {
  const parsed = ruleSchema.partial().parse(rule);
  return {
    tags: validTags(parsed.tags ?? []),
    tag_match: parsed.tag_match ?? 'all',
    exclude_tags: validTags(parsed.exclude_tags ?? []),
    ...(parsed.folder !== undefined && { folder: cleanScope(db, parsed.folder) }),
  };
}

/** How many levels a folder and everything under it span: 1 for a leaf. */
function height(folders: Map<number, VirtualFolder>, id: number): number {
  const children = [...folders.values()].filter((folder) => folder.parent === id);
  return 1 + Math.max(0, ...children.map((child) => height(folders, child.id)));
}

function descendants(folders: Map<number, VirtualFolder>, id: number): VirtualFolder[] {
  const children = [...folders.values()].filter((folder) => folder.parent === id);
  return children.flatMap((child) => [child, ...descendants(folders, child.id)]);
}

/** Refuses a place in the tree that would make a cycle, nest too deep, or leave a scope. */
function checkPlace(
  folders: Map<number, VirtualFolder>,
  id: number | undefined,
  parent: number | null,
  rule: FolderRule,
): void {
  const ancestors = parent === null ? [] : chainIn(folders, parent);
  if (!ancestors) throw new UserError(`There is no virtual folder ${parent}`);
  if (id !== undefined && ancestors.some((folder) => folder.id === id)) {
    throw new UserError('A folder cannot go inside itself');
  }
  const levels = ancestors.length + (id === undefined ? 1 : height(folders, id));
  if (levels > MAX_DEPTH) throw new UserError(`Folders nest at most ${MAX_DEPTH} deep`);
  const scope = rule.folder;
  const outer = ancestors.findLast((folder) => folder.rule.folder)?.rule.folder;
  if (scope && outer && !inside(scope, outer)) {
    throw new UserError(`${scope} is outside ${outer}, the scope of a parent folder`);
  }
  const below = id === undefined ? [] : descendants(folders, id);
  const escaping = below.find(({ rule: own }) => scope && own.folder && !inside(own.folder, scope));
  if (escaping) throw new UserError(`${escaping.name} is scoped outside ${scope}`);
}

/** Saves a new folder, or replaces one by id. Changes no tag. */
export function saveFolder(db: Db, input: SaveVirtualFolder): VirtualFolder {
  return db.transaction(() => {
    const folders = loadFolders(db);
    const { id } = input;
    if (id !== undefined && !db.getVfolder(id))
      throw new UserError(`There is no virtual folder ${id}`);
    const name = cleanName(input.name);
    const parent = input.parent ?? null;
    const rule = cleanRule(db, input.rule);
    checkPlace(folders, id, parent, rule);
    const taken = db.vfolderNamed(name, parent);
    if (taken !== undefined && taken !== id)
      throw new UserError(`There is already a folder ${name} here`);
    const tag = input.tag === undefined ? defaultTag(rule) : input.tag && homeTag(input.tag);
    const values = { name, parent, rule: JSON.stringify(rule), tag };
    const saved = id ?? db.insertVfolder(values, Date.now());
    if (id !== undefined) db.updateVfolder(id, values);
    return toFolder(db.getVfolder(saved)!)!;
  });
}

/** Deletes a folder and the folders under it. Files and their tags stay as they are. */
export function deleteFolder(db: Db, id: number): void {
  if (!db.deleteVfolder(id)) throw new UserError(`There is no virtual folder ${id}`);
}

/** The saved tree, with counts from the search total cache. */
function savedTree(db: Db): VirtualFolderNode[] {
  const folders = loadFolders(db);
  const nodes = (parent: number | null, chain: VirtualFolder[]): VirtualFolderNode[] =>
    [...folders.values()]
      .filter((folder) => folder.parent === parent)
      .map((folder) => {
        const path = [...chain, folder];
        return {
          key: String(folder.id),
          name: folder.name,
          folder,
          count: db.countFiles(effectiveQuery(path)),
          children: path.length < MAX_DEPTH ? nodes(folder.id, path) : [],
        };
      });
  return nodes(null, []);
}

type Draft = { key: string; name: string; count: number | null; children: Map<string, Draft> };

/** Where a tag sits in the generated tree: the keys of its ancestors, then its own. */
function generatedPath(tag: Tag): { key: string; name: string }[] {
  const colon = tag.indexOf(':');
  const namespace = colon > 0 ? tag.slice(0, colon + 1) : '';
  const label = colon > 0 ? tag.slice(colon + 1) : tag;
  const steps = namespace ? [{ key: namespace, name: namespace.slice(0, -1) }] : [];
  const parts = label.split('/');
  parts.forEach((part, i) =>
    steps.push({ key: namespace + parts.slice(0, i + 1).join('/'), name: part }),
  );
  // A month belongs to its year, as it does in a tag filter.
  const month = MONTH_TAG.exec(tag);
  if (month)
    steps.splice(
      -1,
      1,
      { key: month[1]!, name: month[1]!.slice(colon + 1) },
      { key: tag, name: tag.slice(colon + 1) },
    );
  return steps;
}

/**
 * One generated folder per namespace, with a child per value, nested by `/`. A leaf's count is its
 * tag's; only a folder with children pays for a count of its own.
 */
function generatedTree(db: Db): VirtualFolderNode[] {
  const roots = new Map<string, Draft>();
  for (const { tag, count } of db.tagCounts()) {
    let level = roots;
    let node: Draft | undefined;
    for (const step of generatedPath(tag)) {
      node = level.get(step.key);
      if (!node) level.set(step.key, (node = { ...step, count: null, children: new Map() }));
      level = node.children;
    }
    if (node) node.count = count;
  }
  const finish = (level: Map<string, Draft>): VirtualFolderNode[] =>
    [...level.values()]
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((draft) => ({
        key: draft.key,
        name: draft.name,
        folder: null,
        count:
          draft.children.size || YEAR_TAG.test(draft.key) || draft.count === null
            ? db.countFiles(generatedQuery(draft.key))
            : draft.count,
        children: finish(draft.children),
      }));
  return finish(roots);
}

/** What `list_vfolders` returns. */
export function folderTree(db: Db, generated = false): VirtualFolderTree {
  return { saved: savedTree(db), generated: generated ? generatedTree(db) : [] };
}

/**
 * Plans the tags that put files in a folder: its home tag, and the home tag of every ancestor that
 * has one, so the file also passes the rules above it.
 */
export function proposeAdd(db: Db, id: number, fileIds: number[], source: Plan['source']): Plan {
  const chain = requireChain(db, id);
  const folder = chain.at(-1)!;
  if (!folder.tag)
    throw new UserError(`${folder.name} has no home tag, so files cannot be put in it`);
  const add = chain.flatMap((entry) => (entry.tag ? [entry.tag] : []));
  const title = `Add to folder ${folder.name}`;
  return proposeChanges(db, { file_ids: fileIds, add, title }, source);
}

/** Plans removing a folder's home tag. A file the rule still matches through another tag stays. */
export function proposeRemove(db: Db, id: number, fileIds: number[], source: Plan['source']): Plan {
  const folder = requireChain(db, id).at(-1)!;
  if (!folder.tag) throw new UserError(`${folder.name} has no home tag to remove`);
  const title = `Remove from folder ${folder.name}`;
  return proposeChanges(db, { file_ids: fileIds, remove: [folder.tag], title }, source);
}
