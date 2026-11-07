/** Facets: listing them, the user's own, and which are enabled. */
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'smol-toml';
import { z } from 'zod';
import type { Facet, FacetInfo } from '../../types.ts';
import {
  ifExists,
  isTable,
  parseToml,
  paths,
  readRegularFile,
  saveConfig,
  UserError,
  writeFileAtomic,
} from '../config.ts';
import { facetSchema } from '../facet-schema.ts';
import { isEnabled, loadFacets } from '../facets.ts';
import { type Context, nothing, type ToolTable } from './shared.ts';

/** The facet ids one custom facet file defines. A broken file defines none, as in `loadFacets`. */
async function idsInFacetFile(path: string): Promise<string[]> {
  try {
    const { facet: entries } = parseToml(await readRegularFile(path), path);
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) =>
      isTable(entry) && typeof entry.id === 'string' ? [entry.id] : [],
    );
  } catch {
    // `loadFacets` already warned about this file.
    return [];
  }
}

/** Ids of the user's own facets. */
async function customFacetIds(): Promise<Set<string>> {
  const fileNames = (await ifExists(readdir(paths.facetsDir()))) ?? [];
  const tomlPaths = fileNames
    .filter((name) => name.endsWith('.toml'))
    .map((name) => join(paths.facetsDir(), name));
  const idsPerFile = await Promise.all(tomlPaths.map(idsInFacetFile));
  return new Set(idsPerFile.flat());
}

/** Every facet with whether it is enabled and whether it is the user's own. */
async function listFacets(config: Context['config']): Promise<FacetInfo[]> {
  const custom = await customFacetIds();
  const facets = await loadFacets(config);
  return facets.map((facet) => ({
    ...facet,
    enabled: isEnabled(facet, config),
    custom: custom.has(facet.id),
  }));
}

const facetFile = (id: string) => join(paths.facetsDir(), `${id}.toml`);

/** Writes a custom facet to its own file, as a one-facet pack. */
async function saveFacet(facet: Facet): Promise<Facet> {
  const { pack, ...entry } = facet;
  await writeFileAtomic(facetFile(facet.id), stringify({ pack, title: pack, facet: [entry] }));
  return facet;
}

/** Deletes a custom facet's file. A built-in facet has none, so it cannot be deleted. */
async function deleteFacet(id: string): Promise<void> {
  const exists = await ifExists(stat(facetFile(id)));
  if (!exists) throw new UserError(`${id} is not a custom facet`);
  await rm(facetFile(id));
}

/** Turns ids on or off, in `[facets]`. A later `disabled` beats a pack that stays enabled. */
async function setEnabled(ids: string[], enabled: boolean, ctx: Context): Promise<void> {
  const known = await loadFacets(ctx.config);
  for (const id of ids) {
    const exists = known.some((facet) => facet.id === id || facet.pack === id);
    if (!exists) throw new UserError(`There is no facet or pack named "${id}"`);
  }
  // Each id moves to the end of the list it joins, and out of the other.
  const without = (list: string[]) => list.filter((id) => !ids.includes(id));
  const { enabled: wasEnabled, disabled: wasDisabled } = ctx.config.facets;
  const facets = enabled
    ? { enabled: [...without(wasEnabled), ...ids], disabled: without(wasDisabled) }
    : { enabled: without(wasEnabled), disabled: [...without(wasDisabled), ...ids] };
  Object.assign(ctx.config, await saveConfig({ facets }));
}

/** The tools on facets. */
export const facetTools = {
  list_facets: {
    description: 'Every facet, and whether it is enabled.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { config }) => listFacets(config),
  },

  save_facet: {
    description: 'Saves a custom facet.',
    input: facetSchema,
    writes: true,
    agent: false,
    run: async (facet) => saveFacet(facet),
  },

  delete_facet: {
    description: 'Deletes a custom facet.',
    input: z.strictObject({ id: z.string().regex(/^[a-z0-9-]+$/) }),
    writes: true,
    agent: false,
    run: async ({ id }) => deleteFacet(id),
  },

  set_enabled: {
    description: 'Turns facets or packs on or off.',
    input: z.strictObject({ ids: z.array(z.string().min(1)), enabled: z.boolean() }),
    writes: true,
    agent: false,
    run: async ({ ids, enabled }, ctx) => setEnabled(ids, enabled, ctx),
  },
} satisfies Partial<ToolTable>;
