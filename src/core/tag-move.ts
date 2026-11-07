/**
 * Moving and renaming a tag together with every tag under it. Both are prefix renames, stored as a
 * plan with `renames`, so what follows the names moves when the plan is applied and comes back on
 * undo. Nothing is written here. See docs/tags.md#hierarchy.
 */
import type { Facet, Plan, Tag, TagOp, TagRename } from '../types.ts';
import { UserError } from './config.ts';
import type { Db } from './db.ts';
import type { TagOnFile } from './db/tag-tree.ts';
import { proposePlan } from './plans.ts';
import {
  depthOf,
  facetsById,
  isMovable,
  isWithin,
  MAX_TAG_DEPTH,
  placeOf,
  prefixOf,
  type TagPlace,
} from './tag-place.ts';
import { validTags } from './tag-rules.ts';

type PlanSource = Plan['source'];

/** A renamed tag whose new name files already carry. */
type TagMerge = NonNullable<Plan['merges']>[number];

/** A prefix rename to plan: the facets, so depth and facet can be checked, and the plan's title. */
interface PrefixRename extends TagRename {
  facets: Map<string, Facet>;
  title: string;
}

/** The new name of a tag under `from`, once `from` becomes `to`. */
const renamedTag = (tag: Tag, { from, to }: TagRename) => to + tag.slice(from.length);

/** The files under `from`, refusing when there are none. */
function carriersOf(db: Db, from: Tag): TagOnFile[] {
  const rows = db.subtreeTags(from);
  if (rows.length === 0) throw new UserError(`No file has ${from} or a tag under it`);
  return rows;
}

/** Throws when a new name would break a rule: a forbidden character, or more than six levels. */
function checkNewName(tag: Tag, facets: Map<string, Facet>): void {
  validTags([tag]);
  const { label } = placeOf(tag, facets);
  const depth = label === null ? 1 : depthOf(label);
  if (depth > MAX_TAG_DEPTH) {
    throw new UserError(`${tag} would be ${depth} levels deep, and the most is ${MAX_TAG_DEPTH}`);
  }
}

/** Each old name under `from` and its new one, checked. */
function renamesOf(rows: TagOnFile[], rename: PrefixRename): Map<Tag, Tag> {
  const names = new Map<Tag, Tag>();
  for (const { tag } of rows) if (!names.has(tag)) names.set(tag, renamedTag(tag, rename));
  for (const [old, renamed] of names) {
    checkNewName(renamed, rename.facets);
    // A new name that is also an old one would be added and removed by one op, and lost.
    if (names.has(renamed)) throw new UserError(`${old} would become ${renamed}, which also moves`);
  }
  return names;
}

/** One op per file, renaming every tag under `from` that it carries. */
function opsOf(rows: TagOnFile[], names: Map<Tag, Tag>): TagOp[] {
  const ops = new Map<number, TagOp>();
  for (const { tag, file_id } of rows) {
    const op = ops.get(file_id) ?? { file_id, add: [], remove: [] };
    op.add.push(names.get(tag)!);
    op.remove.push(tag);
    ops.set(file_id, op);
  }
  return [...ops.values()];
}

/** The renamed tags whose new name files already carry, with how many files each brings. */
function mergesOf(db: Db, rows: TagOnFile[], names: Map<Tag, Tag>): TagMerge[] {
  const carriers = new Map<Tag, number>();
  for (const { tag } of rows) carriers.set(tag, (carriers.get(tag) ?? 0) + 1);
  return [...names]
    .filter(([, into]) => db.filesWithTag(into).length > 0)
    .map(([from, into]) => ({ from, into, files: carriers.get(from)! }));
}

/** Stores the plan of a prefix rename. */
function planPrefixRename(db: Db, rename: PrefixRename, source: PlanSource): Plan {
  const rows = carriersOf(db, rename.from);
  const names = renamesOf(rows, rename);
  const merges = mergesOf(db, rows, names);
  const proposed = proposePlan(db, rename.title, source, opsOf(rows, names));
  const plan: Plan = {
    ...proposed,
    renames: [{ from: rename.from, to: rename.to }],
    ...(merges.length > 0 && { merges }),
  };
  db.savePlan(plan); // the same id, now with what follows it
  return plan;
}

/** Plans renaming `from` and every tag under it to `to`. `rename_tag` with `children`. */
export function proposeRenameWithChildren(
  db: Db,
  facets: Facet[],
  { from, to }: TagRename,
  source: PlanSource,
): Plan {
  const [newTag = ''] = validTags([to]);
  if (!newTag) throw new UserError('The new tag is empty');
  if (isWithin(newTag, from)) throw new UserError(`${newTag} is ${from} or under it`);
  const title = `rename ${from} to ${newTag}, with its children`;
  return planPrefixRename(db, { from, to: newTag, facets: facetsById(facets), title }, source);
}

/** Throws unless `from` can move: an open facet's label, or a plain tag. */
function movablePlace(from: Tag, facets: Map<string, Facet>): TagPlace & { label: string } {
  const place = placeOf(from, facets);
  const isRoot = from.endsWith(':') && facets.has(from.slice(0, -1));
  if (isRoot) throw new UserError(`${from} is a facet, which is always a root`);
  if (place.label === null || !isMovable(place)) {
    throw new UserError(`${from} belongs to ${place.facet?.id}, whose labels are fixed`);
  }
  return { ...place, label: place.label };
}

/** Throws unless `parent` can hold `from`: the same facet, with a label, and not under `from`. */
function checkParent(parent: Tag, from: Tag, place: TagPlace, facets: Map<string, Facet>): void {
  const parentPlace = placeOf(parent, facets);
  if (parentPlace.facet?.id !== place.facet?.id || parentPlace.label === null) {
    throw new UserError(`${parent} is in another facet than ${from}, and tags stay in theirs`);
  }
  if (isWithin(parent, from))
    throw new UserError(`${from} cannot move under itself or its children`);
}

/** Plans moving `from`, and every tag under it, under `parent`, or to the top when it is null. */
export function proposeMove(
  db: Db,
  facets: Facet[],
  { from, parent }: { from: Tag; parent: Tag | null },
  source: PlanSource,
): Plan {
  const known = facetsById(facets);
  const place = movablePlace(from, known);
  if (parent !== null) checkParent(parent, from, place, known);
  const leaf = place.label.split('/').at(-1)!;
  const to = parent === null ? prefixOf(place) + leaf : `${parent}/${leaf}`;
  if (to === from) throw new UserError(`${from} is already there`);
  const title = parent === null ? `move ${from} to the top` : `move ${from} under ${parent}`;
  return planPrefixRename(db, { from, to, facets: known, title }, source);
}
