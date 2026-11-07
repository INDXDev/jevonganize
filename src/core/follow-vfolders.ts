/**
 * Virtual folders follow a renamed tag: the tags in each rule and the home tag take the new name.
 * A namespace such as `topic:` names no path, so it stays.
 */
import type { Tag, TagRename } from '../types.ts';
import type { VirtualFolderRow } from './db.ts';
import { type RenameFollower, renamedTag } from './rename-follower.ts';

/** A virtual folder's rule and home tag as they were before a rename. */
interface FolderBefore {
  id: number;
  rule: string;
  tag: Tag | null;
}

/** A list of tags, as a stored rule holds them. */
const isTagList = (value: unknown): value is Tag[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** True when two tag lists hold the same tags in the same order. */
const sameTags = (left: Tag[], right: Tag[]) => JSON.stringify(left) === JSON.stringify(right);

/** A stored rule and its tag lists, or null when it is damaged. `core/vfolders.ts` checks the rest. */
function parseRule(text: string) {
  try {
    const stored = JSON.parse(text) as Record<string, unknown>;
    const { tags, exclude_tags: exclude = [] } = stored;
    return isTagList(tags) && isTagList(exclude) ? { stored, tags, exclude } : null;
  } catch {
    return null;
  }
}

/** A folder's rule and home tag after the renames, or null when they do not change it. */
function renamedFolder(row: VirtualFolderRow, renames: TagRename[]) {
  const parsed = parseRule(row.rule);
  if (!parsed) return null; // a damaged rule is left for a person to fix or delete
  const rename = (tags: Tag[]) => [...new Set(tags.map((tag) => renamedTag(tag, renames)))];
  const tags = rename(parsed.tags);
  const exclude = rename(parsed.exclude);
  const tag = row.tag === null ? null : renamedTag(row.tag, renames);
  const unchanged =
    sameTags(tags, parsed.tags) && sameTags(exclude, parsed.exclude) && tag === row.tag;
  if (unchanged) return null;
  return { rule: JSON.stringify({ ...parsed.stored, tags, exclude_tags: exclude }), tag };
}

/** Renames the tags in each virtual folder's rule, and its home tag. */
export const vfolderFollower: RenameFollower<FolderBefore[]> = {
  name: 'vfolders',
  follow(db, plan) {
    const before: FolderBefore[] = [];
    for (const row of db.listVfolders()) {
      const after = renamedFolder(row, plan.renames ?? []);
      if (!after) continue;
      before.push({ id: row.id, rule: row.rule, tag: row.tag });
      db.updateVfolder(row.id, { name: row.name, parent: row.parent, ...after });
    }
    return before.length > 0 ? before : undefined;
  },
  restore(db, saved) {
    for (const { id, rule, tag } of saved) {
      const row = db.getVfolder(id);
      if (row) db.updateVfolder(id, { name: row.name, parent: row.parent, rule, tag });
    }
  },
};
