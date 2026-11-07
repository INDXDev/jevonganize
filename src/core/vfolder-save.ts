/**
 * Saving a virtual folder: everything a person gives is checked before it is stored. A name, a rule,
 * a home tag, and a place in the tree that makes no cycle, nests no deeper than `MAX_DEPTH`, and
 * keeps every scope inside its parent's. Saving changes no tag.
 */
import type { FolderRule, Tag, VirtualFolder } from '../types.ts';
import type { SaveVirtualFolder } from '../tool-map.ts';
import { indexedPath, UserError } from './config.ts';
import type { Db } from './db.ts';
import { validTags } from './tag-rules.ts';
import {
  chainIn,
  childrenOf,
  type FolderMap,
  innermostScope,
  isInside,
  loadFolders,
  MAX_DEPTH,
  ruleSchema,
  toFolder,
} from './vfolders.ts';

const MAX_NAME = 120;
const CONTROL = /\p{Cc}/u;

/** Saves a new folder, or replaces one by id. Changes no tag. */
export function saveFolder(db: Db, input: SaveVirtualFolder): VirtualFolder {
  return db.transaction(() => {
    const folders = loadFolders(db);
    const { id } = input;
    const isUpdate = id !== undefined;
    if (isUpdate && !db.getVfolder(id)) throw new UserError(`There is no virtual folder ${id}`);
    const name = cleanName(input.name);
    const parent = input.parent ?? null;
    const rule = cleanRule(db, input.rule);
    checkPlace(folders, id, parent, rule);
    const sameNameHere = db.vfolderNamed(name, parent);
    if (sameNameHere !== undefined && sameNameHere !== id) {
      throw new UserError(`There is already a folder ${name} here`);
    }
    const tag = resolveHomeTag(input.tag, rule);
    const values = { name, parent, rule: JSON.stringify(rule), tag };
    if (isUpdate) db.updateVfolder(id, values);
    const savedId = isUpdate ? id : db.insertVfolder(values, Date.now());
    return toFolder(db.getVfolder(savedId)!)!;
  });
}

/** A name as stored: NFC and trimmed, never empty, too long, or holding control characters. */
function cleanName(name: string): string {
  const clean = name.normalize('NFC').trim();
  if (!clean) throw new UserError('A virtual folder needs a name');
  if (clean.length > MAX_NAME) {
    throw new UserError(`A folder name is at most ${MAX_NAME} characters`);
  }
  if (CONTROL.test(clean)) throw new UserError('A folder name cannot contain control characters');
  return clean;
}

/** A rule as given, validated, with defaults for the fields left out. */
function cleanRule(db: Db, rule: SaveVirtualFolder['rule']): FolderRule {
  const parsed = ruleSchema.partial().parse(rule);
  return {
    tags: validTags(parsed.tags ?? []),
    tag_match: parsed.tag_match ?? 'all',
    exclude_tags: validTags(parsed.exclude_tags ?? []),
    ...(parsed.folder !== undefined && { folder: cleanScope(db, parsed.folder) }),
  };
}

/** The scope of a rule, as an indexed path inside a library. */
function cleanScope(db: Db, folder: string): string {
  const path = indexedPath(folder);
  if (!db.libraryPaths().some((library) => isInside(path, library))) {
    throw new UserError(`${path} is not in a library`);
  }
  return path;
}

/** Refuses a place in the tree that would make a cycle, nest too deep, or leave a scope. */
function checkPlace(
  folders: FolderMap,
  id: number | undefined,
  parent: number | null,
  rule: FolderRule,
): void {
  const ancestors = parent === null ? [] : chainIn(folders, parent);
  if (!ancestors) throw new UserError(`There is no virtual folder ${parent}`);
  checkNesting(ancestors, folders, id);
  checkScope(ancestors, folders, id, rule.folder);
}

/** Refuses a parent that would make a cycle or nest the folder, and all below it, too deep. */
function checkNesting(ancestors: VirtualFolder[], folders: FolderMap, id: number | undefined) {
  if (id !== undefined && ancestors.some((folder) => folder.id === id)) {
    throw new UserError('A folder cannot go inside itself');
  }
  const ownLevels = id === undefined ? 1 : height(folders, id);
  if (ancestors.length + ownLevels > MAX_DEPTH) {
    throw new UserError(`Folders nest at most ${MAX_DEPTH} deep`);
  }
}

/** Refuses a scope outside a parent's scope, or one that a folder below would leave. */
function checkScope(
  ancestors: VirtualFolder[],
  folders: FolderMap,
  id: number | undefined,
  scope: string | undefined,
) {
  if (!scope) return;
  const parentScope = innermostScope(ancestors);
  if (parentScope && !isInside(scope, parentScope)) {
    throw new UserError(`${scope} is outside ${parentScope}, the scope of a parent folder`);
  }
  const below = id === undefined ? [] : descendants(folders, id);
  const escaping = below.find(({ rule }) => rule.folder && !isInside(rule.folder, scope));
  if (escaping) throw new UserError(`${escaping.name} is scoped outside ${scope}`);
}

/** How many levels a folder and everything under it span: 1 for a leaf. */
function height(folders: FolderMap, id: number): number {
  const childHeights = childrenOf(folders, id).map((child) => height(folders, child.id));
  return 1 + Math.max(0, ...childHeights);
}

/** Every folder below this one, at any depth. */
function descendants(folders: FolderMap, id: number): VirtualFolder[] {
  return childrenOf(folders, id).flatMap((child) => [child, ...descendants(folders, child.id)]);
}

/** The home tag to store: the rule's default when none was given, and none when null was. */
function resolveHomeTag(given: Tag | null | undefined, rule: FolderRule): Tag | null {
  if (given === undefined) return defaultHomeTag(rule);
  if (!given) return given; // null or empty: dropping files in is turned off
  return cleanHomeTag(given);
}

/** A folder's own home tag: the one tag of a single-tag rule, unless it names a whole namespace. */
function defaultHomeTag(rule: FolderRule): Tag | null {
  if (rule.tags.length !== 1) return null;
  const [only] = rule.tags;
  if (only === undefined || only.endsWith(':')) return null;
  return only;
}

/** A home tag a person chose, validated. A namespace cannot be one: it is not a tag to write. */
function cleanHomeTag(tag: Tag): Tag {
  const [clean] = validTags([tag]);
  if (!clean || clean.endsWith(':')) {
    throw new UserError(`${JSON.stringify(tag)} cannot be a home tag`);
  }
  return clean;
}
