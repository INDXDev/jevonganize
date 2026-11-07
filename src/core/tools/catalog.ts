/** The topic catalog: the subjects that ship with the app, ready to join `topic`. */
import { basename } from 'node:path';
import { z } from 'zod';
import { estimateCost } from '../../ai/pricing.ts';
import { rankTopics } from '../../ai/pick.ts';
import { resolveModel } from '../../ai/providers.ts';
import { UserError } from '../config.ts';
import { loadCatalog, loadFacets } from '../facets.ts';
import { refusedPathTest } from '../organize.ts';
import { type Context, fileQuery, type ToolTable } from './shared.ts';

const DEFAULT_PICKS = 100;
const DEFAULT_MATCHES = 50;

/** Names of the files in scope. Every request bills them, so a big folder is sampled evenly. */
function folderNames({ db, config }: Context, query: z.infer<typeof fileQuery>): string[] {
  const refused = refusedPathTest(db, config);
  const files = db.fileRefs(query).filter((file) => !refused(file.path));
  const names = [...new Set(files.map((file) => basename(file.path)))].toSorted();
  const chars = names.reduce((total, name) => total + name.length + 1, 0);
  const keep = Math.min(1, config.budget.text_chars / Math.max(chars, 1));
  return names.filter((_, index) => Math.floor(index * keep) !== Math.floor((index - 1) * keep));
}

/** Catalog values `topic` lacks. A value a person retired never comes back. */
async function freshValues({ db, config }: Context): Promise<string[]> {
  const topic = (await loadFacets(config)).find((facet) => facet.id === 'topic');
  const taken = new Set(Object.keys(topic?.values ?? {}));
  for (const { value } of db.listVocabulary('topic')) taken.add(value);
  return (await loadCatalog()).filter((value) => !taken.has(value));
}

/** The tools on the catalog. */
export const catalogTools = {
  search_catalog: {
    description: 'Finds topics in the built-in catalog by text. Free and local.',
    input: z.strictObject({ text: z.string(), limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    run: async ({ text, limit = DEFAULT_MATCHES }) => {
      const wanted = text.toLowerCase();
      return (await loadCatalog()).filter((value) => value.includes(wanted)).slice(0, limit);
    },
  },

  pick_topics: {
    description:
      'Asks the model which catalog topics fit these files. Changes nothing, but sends file names to the provider and costs money.',
    input: z.strictObject({ query: fileQuery, limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    approval: true,
    run: async ({ query, limit = DEFAULT_PICKS }, ctx) => {
      const model = await resolveModel(ctx.config); // refuses here, before anything is sent
      const names = folderNames(ctx, query);
      if (names.length === 0) throw new UserError('There are no indexed files to read names from');
      const { concurrency } = ctx.config;
      const labels = await freshValues(ctx);
      const { topics, tokens } = await rankTopics(names, labels, model, { limit, concurrency });
      return { topics, files: names.length, tokens, cost_usd: estimateCost(tokens, model) };
    },
  },
} satisfies Partial<ToolTable>;
