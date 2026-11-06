/** Finding files and reading what the index knows about them. */
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { indexedPath, UserError } from '../config.ts';
import { fileId, fileQuery, isModel, taggable, type ToolTable } from './shared.ts';

const DEFAULT_ROWS = 50;
const MODEL_MAX_ROWS = 200;

/** The tools that read files from the index. */
export const fileTools = {
  search_files: {
    description: 'Finds files by text, name, folder, tags and type.',
    input: fileQuery,
    writes: false,
    agent: true,
    run: async (query, ctx) => {
      const limit = query.limit ?? DEFAULT_ROWS;
      const allowed = isModel(ctx) ? Math.min(limit, MODEL_MAX_ROWS) : limit;
      return ctx.db.searchFiles({ ...query, limit: allowed });
    },
  },

  get_file: {
    description: 'Everything known about one file, by id or path.',
    input: z.strictObject({ id: fileId.optional(), path: z.string().optional() }),
    writes: false,
    agent: true,
    run: async ({ id, path }, { db }) => {
      if (id === undefined && path === undefined) throw new UserError('Give an id or a path');
      const found = id ?? db.fileByPath(indexedPath(path ?? ''))?.id;
      const detail = found === undefined ? undefined : db.fileDetail(found);
      if (!detail) {
        const hint = path === undefined ? '' : ` Run: jevonganize scan ${dirname(resolve(path))}`;
        throw new UserError(`${path ?? `File ${id}`} is not in the index.${hint}`);
      }
      return { ...detail, taggable: await taggable(detail.path) };
    },
  },

  similar_files: {
    description: 'Files most like this one, by shared tags.',
    input: z.strictObject({ id: fileId, limit: z.int().positive().optional() }),
    writes: false,
    agent: true,
    run: async ({ id, limit }, { db }) => db.similarFiles(id, limit),
  },

  list_tags: {
    description: 'Tags in use with their counts.',
    input: z.strictObject({ folder: z.string().optional(), facet: z.string().optional() }),
    writes: false,
    agent: true,
    run: async (filter, { db }) => db.tagCounts(filter),
  },

  list_folders: {
    description: 'Folders directly under a folder, with the indexed files below each.',
    input: z.strictObject({ folder: z.string() }),
    writes: false,
    agent: true,
    run: async ({ folder }, { db }) => db.folderCounts(folder),
  },
} satisfies Partial<ToolTable>;
