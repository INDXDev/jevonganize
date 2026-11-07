/** The topic catalog: the subjects that ship with the app, ready to join `topic`. */
import { basename } from 'node:path';
import { z } from 'zod';
import { estimateCost, type TokenUsage } from '../../ai/pricing.ts';
import { rankTopics } from '../../ai/pick.ts';
import { resolveModel } from '../../ai/providers.ts';
import { UserError } from '../config.ts';
import { loadCatalog, loadFacets } from '../facets.ts';
import { refusedPathTest } from '../organize-setup.ts';
import { usageRecorder } from '../usage.ts';
import { type Context, fileQuery, type ToolTable } from './shared.ts';

const DEFAULT_PICKS = 100;
const DEFAULT_MATCHES = 50;

type FileQueryInput = z.infer<typeof fileQuery>;

/**
 * About `ratio` of the names, spread evenly: a name is kept wherever `index * ratio` reaches a new
 * whole number, which keeps the first and then one in every `1 / ratio`.
 */
function sampleEvenly(names: string[], ratio: number): string[] {
  const step = (index: number) => Math.floor(index * ratio);
  return names.filter((_, index) => step(index) !== step(index - 1));
}

/** Names of the files in scope. Every request bills them, so a big folder is sampled evenly. */
function fileNamesInScope({ db, config }: Context, query: FileQueryInput): string[] {
  const isRefused = refusedPathTest(db, config);
  const files = db.fileRefs(query).filter((file) => !isRefused(file.path));
  const names = [...new Set(files.map((file) => basename(file.path)))].toSorted();
  // Each name goes on its own line, so it costs one character more than its length.
  const totalChars = names.reduce((total, name) => total + name.length + 1, 0);
  const keepRatio = Math.min(1, config.budget.text_chars / Math.max(totalChars, 1));
  return sampleEvenly(names, keepRatio);
}

/** Catalog values `topic` lacks. A value a person retired never comes back. */
async function freshValues({ db, config }: Context): Promise<string[]> {
  const topic = (await loadFacets(config)).find((facet) => facet.id === 'topic');
  // Defined values and every vocabulary state count as taken, retired included.
  const taken = new Set(Object.keys(topic?.values ?? {}));
  for (const { value } of db.listVocabulary('topic')) taken.add(value);
  return (await loadCatalog()).filter((value) => !taken.has(value));
}

/** Catalog topics holding the text, ignoring case. */
async function searchCatalog(text: string, limit: number): Promise<string[]> {
  const wanted = text.toLowerCase();
  const catalog = await loadCatalog();
  return catalog.filter((value) => value.includes(wanted)).slice(0, limit);
}

/** Asks the model which fresh catalog topics fit the names of the files in scope. */
async function pickTopics(ctx: Context, query: FileQueryInput, limit: number) {
  const model = await resolveModel(ctx.config); // refuses here, before anything is sent
  const names = fileNamesInScope(ctx, query);
  if (names.length === 0) throw new UserError('There are no indexed files to read names from');
  const { concurrency } = ctx.config;
  const labels = await freshValues(ctx);
  const files = names.length;
  const onTokens = (tokens: TokenUsage) =>
    usageRecorder(ctx.db, 'topics', { files })(model, tokens);
  const { topics, tokens } = await rankTopics(names, labels, model, {
    limit,
    concurrency,
    onTokens,
  });
  const cost_usd = estimateCost(tokens, model);
  return { topics, files, tokens: tokens.input + tokens.output, cost_usd };
}

/** The tools on the catalog. */
export const catalogTools = {
  search_catalog: {
    description: 'Finds topics in the built-in catalog by text. Free and local.',
    input: z.strictObject({ text: z.string(), limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    run: async ({ text, limit = DEFAULT_MATCHES }) => searchCatalog(text, limit),
  },

  pick_topics: {
    description:
      'Asks the model which catalog topics fit these files. Changes nothing, but sends file names to the provider and costs money.',
    input: z.strictObject({ query: fileQuery, limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    approval: true,
    run: async ({ query, limit = DEFAULT_PICKS }, ctx) => pickTopics(ctx, query, limit),
  },
} satisfies Partial<ToolTable>;
