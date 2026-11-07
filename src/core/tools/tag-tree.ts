/**
 * The tag tree: tags as a tree by facet and `/`, and moving a tag with everything under it. A move
 * only stores a plan, so it writes no tag until a person applies it. See docs/tags.md#hierarchy.
 */
import { z } from 'zod';
import { loadFacets } from '../facets.ts';
import { proposeMove } from '../tag-move.ts';
import { listTagTree } from '../tag-tree.ts';
import { planSource, tag, type ToolTable } from './shared.ts';

/** The tools of the tag tree. */
export const tagTreeTools = {
  list_tag_tree: {
    description:
      'Tags as a tree: each facet a root, each "/" a level, with implicit parents and file counts.',
    input: z.strictObject({ facet: z.string().optional(), folder: z.string().optional() }),
    writes: false,
    agent: true,
    run: async (filter, { db, config }) => listTagTree(db, await loadFacets(config), filter),
  },

  move_tag: {
    description:
      'Stores a plan to move a tag, and every tag under it, under another tag of its facet, or to the top when parent is null.',
    input: z.strictObject({ from: tag, parent: tag.nullable() }),
    writes: true,
    agent: true,
    run: async (input, ctx) =>
      proposeMove(ctx.db, await loadFacets(ctx.config), input, planSource(ctx)),
  },
} satisfies Partial<ToolTable>;
