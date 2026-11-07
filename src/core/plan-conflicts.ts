/**
 * Decides whether an organize op still holds. An organize plan was made from what a model saw, so
 * by the time a person applies it the file may have moved on: edited, retagged, or filled up. Any
 * of those makes the op stale, and it fails rather than overwrite a later decision.
 */
import type { Facet, Tag, TagOp } from '../types.ts';
import { isName, tagFacet } from './facets.ts';

/** What an organize op is checked against before it writes. */
export interface ApplyRules {
  facets: Facet[];
  maxTags: number;
}

/** The tag on disk that already fills the one slot of `tag`'s facet, if it has only one. */
function slotRival(tag: Tag, op: TagOp, diskTags: Tag[], facets: Facet[]): Tag | undefined {
  const facet = facets.find(({ id }) => id === tagFacet(tag));
  if (!facet || facet.kind === 'flag' || facet.kind === 'multi') return undefined;
  const fillsSlot = (other: Tag) =>
    other !== tag && tagFacet(other) === facet.id && !op.remove.includes(other);
  return diskTags.find(fillsSlot);
}

/** How many tags a file would hold after this op. */
function tagCountAfter(op: TagOp, diskTags: Tag[]): number {
  const kept = diskTags.filter((tag) => !op.remove.includes(tag));
  return [...kept, ...op.add.filter((tag) => !kept.includes(tag))].filter((tag) => !isName(tag))
    .length;
}

/** Why a tag this op adds is no longer wanted, or null. */
function addedTagConflict(op: TagOp, diskTags: Tag[], rejected: Tag[], facets: Facet[]) {
  for (const tag of op.add) {
    if (rejected.includes(tag)) return `A person rejected ${tag} after this plan was made`;
    const rival = slotRival(tag, op, diskTags, facets);
    if (rival !== undefined) return `The file gained ${rival} after this plan was made`;
  }
  return null;
}

/**
 * Why an organize op no longer holds, or null. Only organize ops carry a stamp: other plans name
 * their tags outright, so they merge whatever happened to the file.
 */
export function conflictReason(
  op: TagOp,
  current: { diskTags: Tag[]; stamp: string },
  indexed: { aiTags: Tag[]; rejected: Tag[] },
  { facets, maxTags }: ApplyRules,
) {
  const { diskTags, stamp } = current;
  if (op.stamp === undefined) return null;
  if (op.stamp !== stamp) return 'The file changed after this plan was made. Organize it again';
  const personTag = op.remove.find(
    (tag) => diskTags.includes(tag) && !indexed.aiTags.includes(tag),
  );
  if (personTag !== undefined) return `A person added ${personTag} after this plan was made`;
  const tagCount = tagCountAfter(op, diskTags);
  const growsPastLimit =
    tagCount > maxTags && tagCount > diskTags.filter((tag) => !isName(tag)).length;
  if (growsPastLimit) return `This would pass max_tags, with ${tagCount} tags`;
  return addedTagConflict(op, diskTags, indexed.rejected, facets);
}
