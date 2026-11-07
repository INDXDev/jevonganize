/**
 * The tables of the config file, one schema each. Every key keeps its TOML name in `snake_case`,
 * and `describe` gives the help text the settings form shows. `config.ts` puts them together.
 */
import { z } from 'zod';

/** One model: `[provider]`, `[chat]`, `[ner]` or a `[profiles.<name>]` table. */
export const providerSchema = z.strictObject({
  name: z.enum(['openai', 'typesafe', 'gateway', 'cloudflare', 'openrouter', 'compatible', 'chat']),
  model: z.string().optional(),
  base_url: z.url().optional(),
  account_id: z.string().optional(),
});

/** `[budget]`: how much of a file is read and sent, so a large file costs a known amount. */
export const budgetSchema = z.strictObject({
  text_chars: z
    .int()
    .positive()
    .default(8000)
    .describe('Text sent per file: 75% from the start, 25% from the end'),
  pdf_pages: z.int().positive().default(10).describe('PDF pages read for text'),
  render_pages: z
    .int()
    .nonnegative()
    .default(2)
    .describe('Pages rendered to images when a PDF has little text'),
  thin_text_chars: z
    .int()
    .nonnegative()
    .default(200)
    .describe('Text per page below which a PDF counts as scanned'),
  images: z.int().nonnegative().default(2).describe('Images sent per file, from any source'),
  image_edge: z.int().positive().default(768).describe('Longest image edge in pixels'),
  sheets: z.int().positive().default(5).describe('Spreadsheet sheets read'),
  sheet_rows: z.int().positive().default(50).describe('Rows read per sheet'),
  zip_entries: z.int().positive().default(200).describe('Archive entry names read'),
  max_parse_mb: z
    .number()
    .positive()
    .default(200)
    .describe('Larger files skip parsers that read the whole file'),
  max_office_mb: z
    .number()
    .positive()
    .default(25)
    .describe('The same limit for Office files, which inflate in memory'),
  timeout_seconds: z.number().positive().default(30).describe('Time limit per file'),
});

/** A colour the UI can give a tag. `auto` takes it from the tag's facet. */
export const tagColorSchema = z.enum([
  'auto',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'gray',
]);

/** `[view]`: how the file browser looks. */
export const viewSchema = z.strictObject({
  show_dotfiles: z
    .boolean()
    .default(false)
    .describe('Show files and folders whose names start with a dot'),
  include_subfolders: z
    .boolean()
    .default(true)
    .describe('Show everything under a folder. Off shows only what sits directly in it'),
  show_extensions: z.boolean().default(true).describe('Show file name extensions'),
  thumbnail_size: z
    .int()
    .min(64)
    .max(512)
    .default(160)
    .describe('Width of a grid tile in pixels, when grid_columns is 0'),
  grid_columns: z
    .int()
    .min(0)
    .max(12)
    .default(0)
    .describe('Tiles per row. 0 fits as many as thumbnail_size allows'),
  grid_spacing: z.int().min(0).max(48).default(10).describe('Space between tiles in pixels'),
  thumbnail_fit: z
    .enum(['cover', 'contain'])
    .default('cover')
    .describe('Cover fills the tile and crops. Contain shows the whole thumbnail'),
  grid_info: z
    .enum(['tags', 'kind', 'size', 'modified', 'none'])
    .default('tags')
    .describe('The line under a file name in the grid'),
  text_size: z.int().min(10).max(20).default(12).describe('File name size in pixels'),
  list_columns: z
    .array(z.enum(['tags', 'kind', 'size', 'modified', 'path']))
    .default(['tags', 'size', 'modified'])
    .describe('Columns of the list, after the name'),
  list_thumbnails: z.boolean().default(false).describe('Show thumbnails in the list, not icons'),
});

/** `[facets]`: packs and facets turned on and off. `disabled` wins. */
export const facetsSchema = z.strictObject({
  enabled: z.array(z.string()).default(['core', 'time', 'sensitivity', 'media']),
  disabled: z.array(z.string()).default([]),
});

/** `[thresholds]`: the confidence an answer needs to apply, or to go to review. */
export const thresholdsSchema = z.strictObject({
  apply: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe('Confidence at or above this joins the plan'),
  review: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe('Confidence at or above this goes to review. Lower is dropped'),
  estimated_to_review: z
    .boolean()
    .default(true)
    .describe('Answers without native probabilities never apply on their own'),
});

/** `[watch]`: whether libraries are watched, and how often they are walked in full. */
export const watchSchema = z.strictObject({
  enabled: z.boolean().default(true),
  walk_minutes: z
    .number()
    .positive()
    .default(30)
    .describe('Minutes between full checks, which catch missed events'),
});

/** One pipeline row: files whose MIME type matches `match` go through the `use` extractors. */
const pipelineStep = (match: string, ...use: string[]) => ({ match, use });

/** First match wins. Documented in docs/pipeline.md, which must stay in step with this. */
export const DEFAULT_PIPELINE = [
  pipelineStep('application/pdf', 'pdf', 'pdf-render'),
  pipelineStep('image/hei*', 'heic', 'exif'),
  pipelineStep('image/svg+xml', 'text', 'image'),
  pipelineStep('image/*', 'image', 'exif', 'screenshot'),
  pipelineStep('audio/*', 'media'),
  pipelineStep('video/*', 'media', 'ffmpeg-frames'),
  pipelineStep('message/rfc822', 'eml'),
  pipelineStep('application/vnd.ms-outlook', 'msg'),
  pipelineStep('application/zip', 'zip'),
  pipelineStep('application/vnd.openxmlformats-*', 'office'),
  pipelineStep('application/vnd.oasis.*', 'office'),
  pipelineStep('application/rtf', 'office'),
  pipelineStep('application/epub+zip', 'office'),
  pipelineStep('text/html', 'office', 'text'),
  pipelineStep('application/msword', 'libreoffice'),
  pipelineStep('application/vnd.ms-excel', 'libreoffice'),
  pipelineStep('application/vnd.ms-powerpoint', 'libreoffice'),
  pipelineStep('text/*', 'text'),
  pipelineStep('*', 'text'),
];
