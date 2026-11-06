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
import { facetSchema, isEnabled, loadFacets } from '../facets.ts';
import { type Context, nothing, type ToolTable } from './shared.ts';

/** Ids of the user's own facets. A broken file counts for nothing, as in `loadFacets`. */
async function customFacetIds(): Promise<Set<string>> {
  const names = (await ifExists(readdir(paths.facetsDir()))) ?? [];
  const ids = new Set<string>();
  for (const name of names.filter((file) => file.endsWith('.toml'))) {
    const file = join(paths.facetsDir(), name);
    try {
      const { facet } = parseToml(await readRegularFile(file), file);
      for (const entry of Array.isArray(facet) ? facet : []) {
        if (isTable(entry) && typeof entry.id === 'string') ids.add(entry.id);
      }
    } catch {
      // `loadFacets` already warned about this file.
    }
  }
  return ids;
}

const facetFile = (id: string) => join(paths.facetsDir(), `${id}.toml`);

async function saveFacet(facet: Facet): Promise<Facet> {
  const { pack, ...entry } = facet;
  await writeFileAtomic(facetFile(facet.id), stringify({ pack, title: pack, facet: [entry] }));
  return facet;
}

/** Turns ids on or off, in `[facets]`. A later `disabled` beats a pack that stays enabled. */
async function setEnabled(ids: string[], enabled: boolean, ctx: Context): Promise<void> {
  const known = await loadFacets(ctx.config);
  for (const id of ids) {
    if (!known.some((facet) => facet.id === id || facet.pack === id)) {
      throw new UserError(`There is no facet or pack named "${id}"`);
    }
  }
  const without = (list: string[]) => list.filter((id) => !ids.includes(id));
  const current = ctx.config.facets;
  const facets = {
    enabled: enabled ? [...without(current.enabled), ...ids] : without(current.enabled),
    disabled: enabled ? without(current.disabled) : [...without(current.disabled), ...ids],
  };
  Object.assign(ctx.config, await saveConfig({ facets }));
}

/** The tools on facets. */
export const facetTools = {
  list_facets: {
    description: 'Every facet, and whether it is enabled.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, { config }): Promise<FacetInfo[]> => {
      const custom = await customFacetIds();
      const facets = await loadFacets(config);
      return facets.map((facet) => ({
        ...facet,
        enabled: isEnabled(facet, config),
        custom: custom.has(facet.id),
      }));
    },
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
    run: async ({ id }) => {
      if (!(await ifExists(stat(facetFile(id)))))
        throw new UserError(`${id} is not a custom facet`);
      await rm(facetFile(id));
    },
  },

  set_enabled: {
    description: 'Turns facets or packs on or off.',
    input: z.strictObject({ ids: z.array(z.string().min(1)), enabled: z.boolean() }),
    writes: true,
    agent: false,
    run: async ({ ids, enabled }, ctx) => setEnabled(ids, enabled, ctx),
  },
} satisfies Partial<ToolTable>;
