/** Contracts shared by every layer. This module imports nothing. See docs/contracts.md. */

/** A file's tags, as stored on disk: `facet:value`, or any plain string a person wrote. */
export type Tag = string;

/** A supported human-facing language, after resolving the system preference. */
export type Language = 'en' | 'ja' | 'zh-CN';

/** How a facet gets its value, and what its tag looks like. See docs/presets.md. */
export type FacetKind =
  | 'flag' // yes or no. Present means yes
  | 'choice' // one of a closed set
  | 'multi' // any of a closed set
  | 'level' // one step on an ordered scale
  | 'date' // a year, or a year and month, that the model picks from generated options
  | 'field'; // copied from file metadata, with no model call

/** One attribute of a file. Presets and custom facets share this shape. */
export interface Facet {
  id: string;
  pack: string;
  title: string;
  kind: FacetKind;
  /** The question put to the model. Unused by `field`. */
  instructions?: string;
  /** Label to one-line definition, for `choice` and `multi`. The definition is the prompt. */
  values?: Record<string, string>;
  /** Ordered labels, lowest first, for `level`. */
  levels?: string[];
  /** Old label to current label. Applied after the answer, so it costs no model call. */
  aliases?: Record<string, string>;
  /** MIME globs this facet applies to. Empty means every file. */
  applies_to: string[];
  /** Metadata key for `field`, such as `author`. */
  field?: string;
  /** Transform for `field`: `year`, `month`, `fiscal-year`, or none. */
  format?: 'year' | 'month' | 'fiscal-year';
  /** `month` for a `date` facet that also asks for the month. */
  precision?: 'year' | 'month';
  /** Open vocabulary: accepted suggestions become new values. */
  open?: boolean;
  /** Weight in similarity. 0 leaves the facet out of it. */
  weight: number;
  /** Confidence needed to apply, overriding `thresholds.apply`. */
  apply_above?: number;
  /** Named model profile for this facet, if not the default. */
  profile?: string;
}

/** What `pick_topics` chose from the catalog, the likeliest first. */
export interface TopicPicks {
  topics: { value: string; probability: number }[];
  /** How many file names were sent. */
  files: number;
  tokens: number;
  cost_usd: number | null;
}

/** A facet as listed by `list_facets`. */
export interface FacetInfo extends Facet {
  enabled: boolean;
  /** True for a user's facet, which can be edited and deleted. */
  custom: boolean;
}

/** The model's input for one file, after extraction and budgets. */
export interface FileState {
  text: string;
  images: { data: Uint8Array; mediaType: string; source: string }[];
  metadata: Record<string, string | number | boolean>;
  warnings: string[];
}

/**
 * One raw answer. Kept as returned, and thresholds apply later. A `multi` facet gives one answer
 * per label, and a `flag` gives one with value `yes`. `confidence` is then P(true).
 */
export interface Answer {
  facet: string;
  /** The chosen label. Null when refused, or when the model answered `other` or a level's `none`. */
  value: string | null;
  /** 0 to 1. Null when the provider gave no usable probability. */
  confidence: number | null;
  /** True when a chat model estimated this rather than a native decision model. */
  estimated: boolean;
  refused: boolean;
}

/** What should happen to one file's tags. */
export interface TagOp {
  file_id: number;
  add: Tag[];
  remove: Tag[];
  /** Organize only: the file's content as judged. Applying refuses a file that has changed since. */
  stamp?: string;
}

/** `applying` is a claim held by a running apply. See docs/contracts.md. */
export type PlanStatus = 'proposed' | 'applying' | 'applied' | 'undone' | 'failed';

/** A stored, reviewable set of tag changes. */
export interface Plan {
  id: string;
  title: string;
  source: 'organize' | 'user' | 'chat' | 'mcp' | 'cleanup';
  status: PlanStatus;
  created_at: number;
  ops: TagOp[];
  /** Op counts and a sample, for previews without loading every op. */
  summary: { files: number; added: Record<Tag, number>; removed: Record<Tag, number> };
  /** Reasons by file id for ops that could not be applied. */
  errors?: Record<number, string>;
}

/** An item waiting for a person. */
export interface ReviewItem {
  id: number;
  file_id: number;
  kind: 'suggest' | 'restore';
  tag: Tag;
  confidence: number | null;
  /** Why it is here, in a few words. */
  reason: string;
}

/** A file as the UI and tools see it. */
export interface FileRow {
  id: number;
  path: string;
  name: string;
  size: number;
  mtime_ms: number;
  mime: string | null;
  tags: Tag[];
  /** `organized` once classified with the current facets. */
  status: 'new' | 'organized' | 'failed';
}

/** Everything the inspector shows for one file. */
export interface FileDetail extends FileRow {
  metadata: Record<string, string | number | boolean>;
  answers: Answer[];
  reviews: ReviewItem[];
  /** False when this volume cannot store tags. */
  taggable: boolean;
}

export interface SimilarFile extends FileRow {
  /** 0 to 1, IDF-weighted Jaccard. */
  score: number;
  shared: Tag[];
}

export interface TagCount {
  tag: Tag;
  facet: string | null;
  count: number;
}

/** A filter over the index. Every field narrows the result. */
export interface FileQuery {
  /** Full-text and file name search. */
  text?: string;
  /** Folder prefix. */
  folder?: string;
  /** These tags, matching children: `topic:finance` matches `topic:finance/tax`. */
  tags?: Tag[];
  /** Whether a file needs `any` of `tags` or `all` of them. Default `all`. */
  tag_match?: 'any' | 'all';
  /** None of these. */
  exclude_tags?: Tag[];
  mime?: string;
  status?: FileRow['status'];
  /** Leaves out names starting with a dot, and anything in such a folder under its library. */
  hide_dotfiles?: boolean;
  /** Only what sits directly in `folder`, not in its subfolders. */
  direct_only?: boolean;
  sort?: 'name' | 'kind' | 'modified' | 'size' | 'relevance';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/** A folder directly under another, with every indexed file below it. */
export interface FolderCount {
  name: string;
  path: string;
  files: number;
}

export interface Library {
  path: string;
  files: number;
  taggable: boolean;
  scanned_at: number | null;
}

/** A named background operation. */
export interface Job {
  id: string;
  kind: 'scan' | 'organize' | 'apply' | 'undo';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** Milliseconds since the epoch, like `Plan.created_at`. */
  started_at: number;
  done: number;
  total: number;
  /** The file being worked on. */
  current?: string;
  /** Provider tokens and USD so far, for `organize` and `names`. */
  tokens?: number;
  cost_usd?: number | null;
  /** The plan an `organize` job produced, or the one an `apply` or `undo` job works on. */
  plan_id?: string;
  /** Files or ops that failed. The job goes on, so it can end `done` with some. */
  failed?: number;
  /** For people, set when the job ends. */
  warnings?: string[];
  /** What a `scan` job found. */
  scan?: {
    files: number;
    added: number;
    changed: number;
    moved: number;
    removed: number;
    restores: number;
    skipped: number;
  };
  error?: string;
}

/** Server-sent events on `/api/events`. */
export type ServerEvent =
  | { type: 'job'; job: Job }
  | { type: 'files'; ids: number[] }
  | { type: 'reviews'; count: number };

/** What `organize --dry-run` reports before any money is spent. */
export interface Estimate {
  files: number;
  cached: number;
  facets: number;
  tokens: number;
  cost_usd: number | null;
  provider: string;
  model: string;
}

/** Name of a provider in the provider table. */
export type ProviderName =
  | 'openai'
  | 'typesafe'
  | 'gateway'
  | 'cloudflare'
  | 'openrouter'
  | 'compatible'
  | 'chat';

/** A result of `doctor`. */
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** What `status` reports. */
export interface Status {
  libraries: Library[];
  files: number;
  organized: number;
  tags: number;
  reviews: number;
  jobs: Job[];
  provider: string;
  model: string;
  has_key: boolean;
  /** Providers with a stored key. Never the keys themselves. */
  keys: ProviderName[];
}

/** What `browse_dirs` reports: a folder, for the folder picker. */
export interface DirListing {
  path: string;
  parent: string | null;
  /** Home, and the usual folders in it. */
  places: string[];
  /** `size` and `modified` are null when the entry could not be read. */
  entries: { name: string; dir: boolean; size: number | null; modified: number | null }[];
}

/** What `list_keys` reports. Never the keys themselves. */
export interface KeyList {
  /** `in_env` says the variable is set, even while environment keys are off. */
  keys: { provider: ProviderName; source: 'env' | 'file' | null; in_env: boolean }[];
  /** Whether keys from the environment are used. Null until someone has answered. */
  env_allowed: boolean | null;
}

/** A value of an open facet. */
export interface VocabularyEntry {
  facet: string;
  value: string;
  state: 'proposed' | 'active' | 'retired';
}

/** What `cleanup_report` finds. */
export interface CleanupReport {
  near_duplicates: { tags: Tag[]; files: number }[];
  single_use: TagCount[];
  over_broad: TagCount[];
}

type ChangeScope = { query?: FileQuery; file_ids?: number[] };

/** Every tool's input and output, as `[input, output]`. docs/contracts.md describes each one. */
export interface ToolMap {
  status: [Record<string, never>, Status];
  list_libraries: [Record<string, never>, Library[]];
  add_library: [{ path: string }, Library];
  remove_library: [{ path: string }, void];
  browse_dirs: [{ path?: string }, DirListing];
  scan: [{ path?: string }, Job];
  search_files: [FileQuery, { files: FileRow[]; total: number }];
  get_file: [{ id?: number; path?: string }, FileDetail];
  similar_files: [{ id: number; limit?: number }, SimilarFile[]];
  list_tags: [{ folder?: string; facet?: string }, TagCount[]];
  list_folders: [{ folder: string }, FolderCount[]];
  list_facets: [Record<string, never>, FacetInfo[]];
  save_facet: [Facet, Facet];
  delete_facet: [{ id: string }, void];
  set_enabled: [{ ids: string[]; enabled: boolean }, void];
  search_catalog: [{ text: string; limit?: number }, string[]];
  pick_topics: [{ query: FileQuery; limit?: number }, TopicPicks];
  estimate: [{ query: FileQuery; facets?: string[] }, Estimate];
  organize: [{ query: FileQuery; facets?: string[] }, Job];
  cancel_job: [{ id: string }, void];
  propose_changes: [ChangeScope & { add?: Tag[]; remove?: Tag[]; title: string }, Plan];
  rename_tag: [{ from: Tag; to: Tag }, Plan];
  apply_plan: [{ id: string }, Job];
  undo_plan: [{ id: string }, Job];
  get_plan: [{ id: string }, Plan];
  discard_plan: [{ id: string }, void];
  list_plans: [{ status?: PlanStatus }, Plan[]];
  list_reviews: [{ tag?: Tag; limit?: number }, ReviewItem[]];
  resolve_reviews: [{ ids: number[]; accept: boolean }, Plan | null];
  suggest_tags: [{ id: number }, ReviewItem[]];
  set_vocabulary: [{ facet: string; value: string; state: 'active' | 'retired' }, void];
  cleanup_report: [Record<string, never>, CleanupReport];
  list_vocabulary: [{ facet?: string }, VocabularyEntry[]];
  get_config: [
    Record<string, never>,
    {
      config: Record<string, unknown>;
      system_language: Language;
      schema: unknown;
      paths: { config: string; data: string; cache: string };
    },
  ];
  set_config: [Record<string, unknown>, Record<string, unknown>];
  list_keys: [Record<string, never>, KeyList];
  set_api_key: [{ provider: ProviderName; key: string }, void];
  remove_api_key: [{ provider: ProviderName }, { removed: boolean }];
  set_env_keys: [{ allowed: boolean }, void];
  reveal_file: [{ id: number }, void];
  open_file: [{ id: number }, void];
  doctor: [Record<string, never>, Check[]];
}

export type ToolName = keyof ToolMap;
