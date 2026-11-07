/** The mock's config and its JSON Schema. */
const int = (minimum?: number, maximum?: number, description?: string) => ({
  type: 'integer',
  minimum,
  maximum,
  description,
});

const PROVIDER_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      enum: ['openai', 'typesafe', 'gateway', 'cloudflare', 'openrouter', 'compatible', 'chat'],
    },
    model: { type: 'string' },
    base_url: { type: 'string' },
    account_id: { type: 'string' },
  },
};

const ratio = (description: string) => ({ type: 'number', minimum: 0, maximum: 1, description });

/** The schema of the settings screen. */
export const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    language: {
      type: 'string',
      enum: ['system', 'en', 'ja', 'zh-CN'],
      description: 'Interface language: system default, English, Japanese or Simplified Chinese',
    },
    port: int(1024, 65535, 'The next free port is used if this one is taken.'),
    concurrency: int(1, 64),
    max_tags: int(1, 50, 'Hard cap per file, counting tags a person added.'),
    fiscal_year_start: int(1, 12, 'Month, for fiscal-year fields.'),
    exclude: {
      type: 'array',
      items: { type: 'string' },
      description: 'Added to the built-in secret exclusions.',
    },
    send_images: { type: 'boolean', description: 'Off keeps every image on this machine.' },
    tag_colors: { type: 'object', additionalProperties: { type: 'string' } },
    view: {
      type: 'object',
      properties: {
        show_dotfiles: { type: 'boolean' },
        thumbnail_size: int(64, 512, 'Width of a grid tile in pixels.'),
        grid_columns: int(0, 12, 'Tiles per row. 0 fits by size.'),
      },
    },
    provider: PROVIDER_SCHEMA,
    profiles: { type: 'object', additionalProperties: PROVIDER_SCHEMA },
    chat: PROVIDER_SCHEMA,
    ner: PROVIDER_SCHEMA,
    facets: {
      type: 'object',
      properties: {
        enabled: { type: 'array', items: { type: 'string' } },
        disabled: { type: 'array', items: { type: 'string' } },
      },
    },
    thresholds: {
      type: 'object',
      properties: {
        apply: ratio('At or above: joins the plan.'),
        review: ratio('At or above: review queue. Below: dropped.'),
        estimated_to_review: {
          type: 'boolean',
          description: 'Answers without native probabilities never auto-apply.',
        },
      },
    },
    budget: {
      type: 'object',
      properties: {
        text_chars: int(1),
        pdf_pages: int(1),
        images: int(0),
        image_edge: int(1),
        max_parse_mb: { type: 'number', minimum: 0 },
        timeout_seconds: { type: 'number', minimum: 0 },
      },
    },
    pipeline: {
      type: 'array',
      items: { type: 'object', properties: { match: { type: 'string' } } },
    },
    watch: {
      type: 'object',
      properties: { enabled: { type: 'boolean' }, walk_minutes: { type: 'number', minimum: 0 } },
    },
  },
};

/** The config the mock starts with. */
export const initialConfig: Record<string, unknown> = {
  language: 'system',
  view: {
    show_dotfiles: false,
    include_subfolders: true,
    show_extensions: true,
    thumbnail_size: 160,
    grid_columns: 0,
    grid_spacing: 10,
    thumbnail_fit: 'cover',
    grid_info: 'tags',
    text_size: 12,
    list_columns: ['tags', 'size', 'modified'],
    list_thumbnails: false,
  },
  port: 48620,
  concurrency: 8,
  max_tags: 10,
  fiscal_year_start: 4,
  exclude: ['node_modules', '.git', '*.tmp'],
  send_images: true,
  provider: { name: 'openai', model: 'gpt-6-luna' },
  profiles: {},
  chat: { name: 'openai', model: 'gpt-6-luna' },
  ner: { name: 'openai', model: 'gpt-5.4-mini' },
  facets: { enabled: ['core', 'time', 'sensitivity', 'media'], disabled: [] },
  thresholds: { apply: 0.5, review: 0.5, estimated_to_review: true },
  budget: {
    text_chars: 8000,
    pdf_pages: 10,
    images: 2,
    image_edge: 768,
    max_parse_mb: 200,
    timeout_seconds: 30,
  },
  pipeline: [{ match: 'application/pdf', use: ['pdf', 'pdf-render'] }],
  watch: { enabled: true, walk_minutes: 30 },
};

/** Merges a config patch, table by table, as `set_config` does. */
export const merge = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries([
    ...Object.entries(a),
    ...Object.entries(b).map(([k, v]) => [
      k,
      v && typeof v === 'object' && !Array.isArray(v)
        ? merge((a[k] ?? {}) as Record<string, unknown>, v as Record<string, unknown>)
        : v,
    ]),
  ]);
