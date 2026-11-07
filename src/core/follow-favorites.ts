/** Favorite tags follow a renamed tag: a starred tag takes its new name and keeps its place. */
import type { Tag } from '../types.ts';
import { type RenameFollower, renamedTag } from './rename-follower.ts';

/** Renames starred tags, and puts back the whole list, in order, on undo. */
export const favoriteFollower: RenameFollower<Tag[]> = {
  name: 'favorites',
  follow(db, plan) {
    const before = db.listFavoriteTags().map((row) => row.tag);
    const after = before.map((tag) => renamedTag(tag, plan.renames ?? []));
    if (after.every((tag, index) => tag === before[index])) return undefined;
    db.replaceFavoriteTags(after);
    return before;
  },
  restore(db, saved) {
    db.replaceFavoriteTags(saved);
  },
};
