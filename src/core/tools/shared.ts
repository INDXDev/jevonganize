/** What the tool modules share: the types of a tool, its input schemas and small helpers. */
import { z } from 'zod';
import { thumbnail } from '../../extract/thumbs.ts';
import type { Facet, Library, Plan, ServerEvent, ToolMap, ToolName } from '../../types.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { refusedPathTest } from '../organize.ts';
import { supported } from '../tags.ts';

/** What every tool runs with. */
export interface Context {
  db: Db;
  config: Config;
  /** Sets `Plan.source`, and gates approval. */
  caller: 'cli' | 'ui' | 'chat' | 'mcp';
  emit(event: ServerEvent): void;
  /** MCP's `--allow-apply`: the person opted out of the gate for this server. */
  approved?: boolean;
}

/** One operation. See the table in docs/contracts.md. */
export interface Tool<I, O> {
  description: string;
  input: z.ZodType<I>;
  run(input: I, ctx: Context): Promise<O>;
  /** Changes tags, config or stored state. */
  writes: boolean;
  /** Offered to chat and MCP. `false` is a security boundary. */
  agent: boolean;
  /** A person must approve it when a model calls it. */
  approval?: boolean;
}

/** The shape of the whole table. */
export type ToolTable = { [K in ToolName]: Tool<ToolMap[K][0], ToolMap[K][1]> };

/** The input of a tool that takes none. */
export const nothing = z.strictObject({}) as unknown as z.ZodType<Record<string, never>>;
/** A tag in a tool's input. */
export const tag = z.string().min(1);
/** A file id in a tool's input. */
export const fileId = z.int().positive();

/** A `FileQuery` in a tool's input. */
export const fileQuery = z.strictObject({
  text: z.string().optional(),
  folder: z.string().optional(),
  tags: z.array(tag).optional(),
  tag_match: z.enum(['any', 'all']).optional(),
  exclude_tags: z.array(tag).optional(),
  mime: z.string().optional(),
  status: z.enum(['new', 'organized', 'failed']).optional(),
  hide_dotfiles: z.boolean().optional(),
  direct_only: z.boolean().optional(),
  sort: z.enum(['name', 'kind', 'modified', 'size', 'relevance']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.int().positive().optional(),
  offset: z.int().nonnegative().optional(),
});

/** True when a model, rather than a person, is calling. */
export const isModel = ({ caller }: Context) => caller === 'chat' || caller === 'mcp';

/** What a plan made by this caller records as its source. */
export const planSource = ({ caller }: Context): Plan['source'] =>
  caller === 'chat' || caller === 'mcp' ? caller : 'user';

/** Stamps tags with their facet and weight, then refreshes the numbers similarity reads. */
export function refreshTags(db: Db, facets: Facet[]): void {
  db.setTagFacets(facets);
  db.refreshIdf();
}

/** Tells front ends how many reviews are open. */
export const emitReviews = (ctx: Context) =>
  ctx.emit({ type: 'reviews', count: ctx.db.stats().reviews });

/** Whether tags can be stored at a path. A failed check counts as no. */
export async function taggable(path: string): Promise<boolean> {
  return supported(path).catch(() => false);
}

/** Every library, with what only the disk can say. */
export async function libraries(db: Db): Promise<Library[]> {
  return Promise.all(
    db.listLibraries().map(async (library) => ({
      ...library,
      taggable: await taggable(library.path),
    })),
  );
}

/** The file behind an id, if it may be read: indexed, in a library, and not excluded. */
export function servableFile(ctx: Context, id: number) {
  const file = ctx.db.fileById(id);
  return file && !refusedPathTest(ctx.db, ctx.config)(file.path) ? file : undefined;
}

/** The cached thumbnail of a file, or null. Decoding happens in the worker pool. */
export async function thumbnailFile(ctx: Context, id: number, size: 256 | 1024) {
  const record = servableFile(ctx, id);
  const row = ctx.db.fileRow(id);
  return record && row ? thumbnail({ ...row, hash: record.hash }, size) : null;
}
