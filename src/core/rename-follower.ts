/** The shape of a rename follower: stored state that names tag paths. See tag-followers.ts. */
import type { Facet, Plan, Tag, TagRename } from '../types.ts';
import type { Db } from './db.ts';
import { isWithin } from './tag-place.ts';

/** One kind of stored state that names tags. `Saved` is what undo needs to put it back. */
export interface RenameFollower<Saved> {
  /** Its key in `Plan.followed`. */
  name: string;
  /** Renames what refers to the plan's renamed tags. Returns what it changed, or undefined. */
  follow(db: Db, plan: Plan, facets: Facet[]): Saved | undefined;
  /** Puts back what `follow` changed. */
  restore(db: Db, saved: Saved): void;
}

/** A tag after the renames: the first rename it falls under gives it its new prefix. */
export function renamedTag(tag: Tag, renames: TagRename[]): Tag {
  const rename = renames.find(({ from }) => isWithin(tag, from));
  return rename ? rename.to + tag.slice(rename.from.length) : tag;
}
