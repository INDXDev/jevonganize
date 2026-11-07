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
  /** Prefix renames: each `from` and every tag under it become `to`. Followers apply them. */
  renames?: TagRename[];
  /** Renamed tags whose new name files already carry, so they merge. */
  merges?: { from: Tag; into: Tag; files: number }[];
  /** What applying `renames` changed beyond the files, by follower, so undo can put it back. */
  followed?: Record<string, unknown>;
}

/** A tag, and every tag under it by `/`, renamed to another prefix. See docs/tags.md#hierarchy. */
export interface TagRename {
  from: Tag;
  to: Tag;
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

/** One node of the tag tree `list_tag_tree` derives from names. See docs/contracts.md. */
export interface TagNode {
  /** The tag, or `<facet>:` for a facet's root. */
  path: string;
  facet: string | null;
  /** The last `/` part, or the facet id on a root. */
  label: string;
  /** 0 for a facet's root, 1 for a first level. */
  depth: number;
  /** Files carrying `path` itself. */
  direct: number;
  /** Files carrying `path` or a tag under it. */
  total: number;
  /** No file carries `path` itself. */
  implicit: boolean;
  /** An open facet's label or a plain tag, which `move_tag` can move. */
  movable: boolean;
  children: TagNode[];
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
  /** More tag conditions, each of which must also hold. A virtual folder's ancestors become these. */
  tag_groups?: TagGroup[];
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

/** Tags a file must carry, `any` of them or `all`, matching children as `FileQuery.tags` does. */
export interface TagGroup {
  tags: Tag[];
  tag_match: 'any' | 'all';
}

/** What a virtual folder collects: a subset of `FileQuery`. See docs/concepts.md#virtual-folders. */
export interface FolderRule {
  /** Empty matches every file, which makes a folder that only groups others. */
  tags: Tag[];
  tag_match: 'any' | 'all';
  exclude_tags: Tag[];
  /** A library, or a folder in one. */
  folder?: string;
}

/** A saved, named rule over tags. It exists only in the index, never on disk. */
export interface VirtualFolder {
  id: number;
  name: string;
  parent: number | null;
  rule: FolderRule;
  /** The tag a file dropped in gets. Null turns dropping off. */
  tag: Tag | null;
  created_at: number;
}

/** One folder in the tree `list_vfolders` returns, saved or generated. */
export interface VirtualFolderNode {
  /** The id as text for a saved folder; the tag or `<namespace>:` for a generated one. */
  key: string;
  name: string;
  /** The stored folder, or null for a generated one. */
  folder: VirtualFolder | null;
  /** The files it holds now. */
  count: number;
  children: VirtualFolderNode[];
}

/** What `list_vfolders` returns. `generated` is empty unless asked for. */
export interface VirtualFolderTree {
  saved: VirtualFolderNode[];
  generated: VirtualFolderNode[];
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
  kind: 'scan' | 'organize' | 'apply' | 'undo' | 'refresh';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** Milliseconds since the epoch, like `Plan.created_at`. */
  started_at: number;
  done: number;
  total: number;
  /** The file being worked on. */
  current?: string;
  /** Provider tokens, in and out, and USD so far: the sums of this job's `usage` rows. */
  tokens?: number;
  cost_usd?: number | null;
  /** The plan an `organize` job produced, or the one an `apply` or `undo` job works on. */
  plan_id?: string;
  /** The tag a `refresh` job spreads. */
  tag?: Tag;
  /** Review items a `refresh` job added. */
  reviews?: number;
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
  /** Files carrying both `tag` and `parent`, an ancestor that adds nothing. */
  redundant_parents: { tag: Tag; parent: Tag; files: number }[];
}

/** Why `refresh_candidates` chose a file. Every signal is computed locally. */
export interface RefreshSignals {
  /** Characteristic words of the tagged files that this file's text holds. */
  terms: string[];
  /** Tags that go with the tag, which this file has. */
  tags: Tag[];
  /** The highest similarity to a tagged file, 0 to 1. */
  similar: number;
  /** A word of the tag's value is in the file name. */
  name: boolean;
}

/** A file that lacks a tag but looks like the files that have it. */
export interface RefreshCandidate extends FileRow {
  /** 0 to 1, the signals combined. */
  score: number;
  signals: RefreshSignals;
}

/** What `refresh_candidates` found for a tag. No model was asked. */
export interface RefreshCandidates {
  tag: Tag;
  /** Files with the tag, or a child of it. */
  tagged: number;
  /** How many of them the search learned from. */
  seeds: number;
  /** The characteristic words it searched for. */
  terms: string[];
  /** The tags that go with this one. */
  tags: Tag[];
  /** Best first. */
  candidates: RefreshCandidate[];
  /** Files left out because their unchanged content was already checked for this tag. */
  checked: number;
  /** What checking `candidates` with the decision model would cost. */
  estimate: Estimate;
}
