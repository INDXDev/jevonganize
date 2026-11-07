/**
 * What an organize run settles before it reads a file: which facets it asks, which models answer
 * them, and which paths it must refuse. Each step can refuse the whole run, so nothing is sent until
 * all of them have passed.
 */
import { sep } from 'node:path';
import { resolveModel, type ResolvedModel } from '../ai/providers.ts';
import type { Facet } from '../types.ts';
import { type Config, UserError } from './config.ts';
import type { Db } from './db.ts';
import { sharedExclusions } from './exclusions.ts';
import { toQuestions } from './facet-questions.ts';
import { isEnabled, loadFacets, withVocabulary } from './facets.ts';
import { NAME_GATE, nameReader } from './names.ts';

/** The facet whose tags are the proper names a file contains. */
export const NAME_FACET = 'entity';

/** Models by profile, and `undefined` for the default. */
export type Models = Map<string | undefined, ResolvedModel>;

/** True when a facet puts a question to a model. */
export const asksModel = (facet: Facet) => Object.keys(toQuestions(facet)).length > 0;

/** The facets that put a question to this profile's model. */
export const facetsAskedOf = (facets: Facet[], profile: string | undefined) =>
  facets.filter((facet) => asksModel(facet) && facet.profile === profile);

/** Refuses a facet id or pack name that does not exist, rather than running with fewer facets. */
function checkFacetIds(all: Facet[], ids: string[]): void {
  for (const id of ids) {
    const known = all.some((facet) => facet.id === id || facet.pack === id);
    if (!known) throw new UserError(`There is no facet or pack named "${id}"`);
  }
}

/** The facets of a run, with active vocabulary merged in. */
export async function facetsForRun(db: Db, config: Config, ids?: string[]): Promise<Facet[]> {
  const all = await loadFacets(config);
  if (ids) checkFacetIds(all, ids);
  const chosen = ids
    ? all.filter((facet) => ids.includes(facet.id) || ids.includes(facet.pack))
    : all.filter((facet) => isEnabled(facet, config));
  // Names go with every run. The gate only pays off with a model to read what it finds.
  const canReadNames = (await nameReader(config)) !== undefined;
  const nameFacets = all.filter(
    ({ id }) => id === NAME_FACET || (canReadNames && id === NAME_GATE),
  );
  const facets = withVocabulary([...new Set([...chosen, ...nameFacets])], db);
  return facets.filter((facet) => facet.id !== NAME_FACET || asksModel(facet));
}

/** Builds every model a run needs, so a missing key refuses before the first byte is sent. */
export async function modelsForRun(config: Config, facets: Facet[]): Promise<Models> {
  const models: Models = new Map();
  for (const { profile } of facets.filter(asksModel)) {
    if (!models.has(profile)) models.set(profile, await resolveModel(config, profile));
  }
  return models;
}

/**
 * True for a path that must not be read: a secret, excluded, or in no library. The scan already
 * skips these, but a rule may be newer than the row, and a row may name a renamed file.
 */
export function refusedPathTest(db: Db, config: Config): (path: string) => boolean {
  const libraries = db
    .libraryPaths()
    .map((path) => ({ path, isExcluded: sharedExclusions(config, path) }));
  return (path) => {
    const library = libraries.find((candidate) => path.startsWith(candidate.path + sep));
    return !library || library.isExcluded(path, false);
  };
}
