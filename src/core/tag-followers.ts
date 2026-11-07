/**
 * What follows a renamed tag beyond the files: stored state that names a tag path. Applying a plan
 * with `renames` runs every follower after its ops, and keeps what each changed in
 * `Plan.followed`, so undo can put it back. A new kind of state that names tags adds one follower to `FOLLOWERS` and nothing else. See docs/contracts.md.
 */
import type { Facet, Plan } from '../types.ts';
import type { Db } from './db.ts';
import { favoriteFollower } from './follow-favorites.ts';
import { vfolderFollower } from './follow-vfolders.ts';
import { vocabularyFollower } from './follow-vocabulary.ts';
import type { RenameFollower } from './rename-follower.ts';

/** Every follower, in the order they run. */
const FOLLOWERS = [
  vocabularyFollower,
  vfolderFollower,
  favoriteFollower,
] as RenameFollower<unknown>[];

/**
 * Runs every follower for the renames of a plan that just applied, and returns the plan holding
 * what they changed in `followed`. Any other plan comes back as it is. Call it in the transaction
 * that stores the plan, so the renames follow exactly once.
 */
export function withRenamesFollowed(db: Db, plan: Plan, facets: Facet[]): Plan {
  if (plan.status !== 'applied' || !plan.renames?.length) return plan;
  const followed: Record<string, unknown> = {};
  for (const follower of FOLLOWERS) {
    const saved = follower.follow(db, plan, facets);
    if (saved !== undefined) followed[follower.name] = saved;
  }
  return Object.keys(followed).length > 0 ? { ...plan, followed } : plan;
}

/**
 * Puts back what the followers changed, once undo has reversed every op of the plan. A plan still
 * `applied` keeps the new names, as some of its files still carry them.
 */
export function restoreFollowed(db: Db, plan: Plan): void {
  if (plan.status !== 'undone' || !plan.followed) return;
  for (const follower of FOLLOWERS) {
    const saved = plan.followed[follower.name];
    if (saved !== undefined) follower.restore(db, saved);
  }
}
