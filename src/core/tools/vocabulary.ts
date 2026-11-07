/**
 * The vocabulary of open facets. An open facet can grow new values: they start as proposed, and
 * turn active when a person accepts them, or retired when a person turns them down.
 */
import type { Tag } from '../../types.ts';
import { type Config, UserError } from '../config.ts';
import type { Db } from '../db.ts';
import { fitTag, loadFacets, slug } from '../facets.ts';

/** The value part of a tag: what is after its first colon. */
export const valueOfTag = (tag: Tag) => tag.slice(tag.indexOf(':') + 1);

/** The ids of the facets that grow new values. */
export async function loadOpenFacetIds(config: Config): Promise<string[]> {
  const facets = await loadFacets(config);
  return facets.filter((facet) => facet.open).map((facet) => facet.id);
}

/** A value as an open facet stores it: each `/` level slugged, and empty levels dropped. */
function toVocabularyValue(value: string): string {
  const levels = value.split('/').map(slug).filter(Boolean);
  const fitted = fitTag(levels.join('/'));
  if (!fitted) throw new UserError(`"${value}" has nothing a tag can hold`);
  return fitted;
}

/** Activates or retires one value of an open facet. Other facets have no vocabulary. */
export async function setOpenFacetValue(
  db: Db,
  config: Config,
  { facet, value, state }: { facet: string; value: string; state: 'active' | 'retired' },
): Promise<void> {
  const openFacets = await loadOpenFacetIds(config);
  if (!openFacets.includes(facet)) throw new UserError(`${facet} is not an open facet`);
  db.setVocabulary(facet, toVocabularyValue(value), state);
}
