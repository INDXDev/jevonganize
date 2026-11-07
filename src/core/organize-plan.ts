/**
 * Steps 3 and 5 of organize for one file: its answers become tags to add, tags to drop, and doubtful
 * tags for a person to review. Only tags the app wrote can be dropped, and a person's tag is never
 * touched.
 */
import type { Answer, Facet, Tag } from '../types.ts';
import type { Config } from './config.ts';
import type { Db, MirrorTag } from './db.ts';
import { resolve } from './answer-tags.ts';
import { isName, tagFacet } from './facets.ts';

/** A file's proposed change. */
export interface TagChange {
  add: Tag[];
  remove: Tag[];
  /** Tags not sure enough to apply, for a person to accept or reject. */
  review: { tag: Tag; confidence: number | null }[];
}

/** What a run found about a file: the model's answers and the tags read from its metadata. */
export interface Findings {
  answers: Answer[];
  derived: Tag[];
}

/** The tags this run may drop or replace on a file. */
function replaceableTags(mirror: MirrorTag[], facets: Facet[], answers: Answer[]): Tag[] {
  // A refusal says nothing about a tag, so it stays as if this facet was not part of the run.
  const refused = new Set(answers.filter((answer) => answer.refused).map(({ facet }) => facet));
  const answered = new Set(facets.map((facet) => facet.id).filter((id) => !refused.has(id)));
  // A tag the app wrote may follow a new answer. A person's tag is never touched.
  return mirror
    .filter((row) => row.ai && answered.has(tagFacet(row.tag)) && !isName(row.tag))
    .map((row) => row.tag);
}

/** Every name, and other tags up to `freeSlots`: names do not count towards `max_tags`. */
function fitToSlots(tags: Tag[], freeSlots: number): Tag[] {
  const others = tags.filter((tag) => !isName(tag));
  return [...tags.filter(isName), ...others.slice(0, freeSlots)];
}

/** Turns one file's findings into its change, against the tags it holds now. */
export function planChange(
  { db, config }: { db: Db; config: Config },
  fileId: number,
  facets: Facet[],
  { answers, derived }: Findings,
): TagChange {
  const mirror = db.fileTags(fileId);
  const replaceable = replaceableTags(mirror, facets, answers);
  const isReplaceable = (tag: Tag) => replaceable.includes(tag);
  const keptTags = mirror.map((row) => row.tag).filter((tag) => !isReplaceable(tag));
  const held = { existing: keptTags, rejected: db.rejectedTags(fileId), derived };
  const { apply, review } = resolve(answers, facets, config, held);

  const wanted = new Set([...apply, ...review.map((item) => item.tag)]);
  const remove = replaceable.filter((tag) => !wanted.has(tag));
  // `resolve` left room for `keptTags` only. The replaceable tags that stay take slots as well.
  const replaceableKept = replaceable.length - remove.length;
  const slotsTaken = keptTags.filter((tag) => !isName(tag)).length + replaceableKept;
  const freeSlots = Math.max(config.max_tags - slotsTaken, 0);
  const fresh = apply.filter((tag) => !isReplaceable(tag));
  return {
    add: fitToSlots(fresh, freeSlots),
    remove,
    review: review.filter((item) => !isReplaceable(item.tag)),
  };
}
