/**
 * Where a tag sits in the tag tree: under which facet, at which label, and whether it may move.
 * Pure rules over a tag's name; see docs/tags.md#hierarchy.
 */
import type { Facet, Tag } from '../types.ts';

/** The deepest a label may go, counted in `/` parts. */
export const MAX_TAG_DEPTH = 6;

const FLAG_PREFIX = 'flag:';

/** Where a tag sits: its facet, when it has a known one, and its label, null for a `flag:` tag. */
export interface TagPlace {
  facet: Facet | null;
  label: string | null;
}

/** The facets by id. */
export const facetsById = (facets: Facet[]) => new Map(facets.map((facet) => [facet.id, facet]));

/** The facet a `flag:` tag names, if it is a known one. */
function flagFacet(tag: Tag, facets: Map<string, Facet>): Facet | undefined {
  return tag.startsWith(FLAG_PREFIX) ? facets.get(tag.slice(FLAG_PREFIX.length)) : undefined;
}

/**
 * The facet and label of a tag. A prefix that is not a known facet makes the whole tag plain, and
 * so does an empty first level, which could not sit under the facet's root.
 */
export function placeOf(tag: Tag, facets: Map<string, Facet>): TagPlace {
  const flagged = flagFacet(tag, facets);
  if (flagged) return { facet: flagged, label: null };
  const colon = tag.indexOf(':');
  const facet = colon > 0 ? facets.get(tag.slice(0, colon)) : undefined;
  const label = tag.slice(colon + 1);
  const hasFirstLevel = label !== '' && !label.startsWith('/');
  return facet && hasFirstLevel ? { facet, label } : { facet: null, label: tag };
}

/** How many `/` levels a label has. */
export const depthOf = (label: string) => label.split('/').length;

/** The part of a tag before its label: `topic:` for a facet tag, nothing for a plain one. */
export const prefixOf = ({ facet }: TagPlace) => (facet ? `${facet.id}:` : '');

/** True when `move_tag` may move a tag: an open facet's label, or a plain tag. */
export const isMovable = ({ facet, label }: TagPlace) =>
  label !== null && (facet === null || facet.open === true);

/** True when `tag` is `parent` or under it by `/`. */
export const isWithin = (tag: Tag, parent: Tag) => tag === parent || tag.startsWith(`${parent}/`);
