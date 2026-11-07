/**
 * Every tool's input and output: the typed form of the tool table in docs/contracts.md. Imports
 * only the shapes in `types.ts`.
 */
import type {
  Check,
  CleanupReport,
  DirListing,
  Estimate,
  Facet,
  FacetInfo,
  FileDetail,
  FileQuery,
  FileRow,
  FolderCount,
  FolderRule,
  Job,
  KeyList,
  Language,
  Library,
  Plan,
  PlanStatus,
  ProviderName,
  RefreshCandidates,
  ReviewItem,
  SimilarFile,
  Status,
  Tag,
  TagCount,
  TagNode,
  TopicPicks,
  VirtualFolder,
  VirtualFolderTree,
  VocabularyEntry,
} from './types.ts';

/** What a recorded model call was for. `organize-cache` rows count files that cost nothing. */
export type UsageFeature =
  | 'organize'
  | 'organize-cache'
  | 'names'
  | 'suggest'
  | 'topics'
  | 'refresh'
  | 'chat';

/** A tag a person starred, with how many files carry it now. It stays listed at a count of 0. */
export interface FavoriteTag {
  tag: Tag;
  facet: string | null;
  count: number;
  /** 0 first. */
  position: number;
}

/** Recorded model calls added up. `cost_usd` counts known prices only. */
export interface UsageTotals {
  calls: number;
  files: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** Calls whose model has no known price, left out of `cost_usd`. */
  unknown_cost_calls: number;
}

/** What `usage_report` returns. Every row was recorded on this machine. */
export interface UsageReport {
  totals: UsageTotals;
  /** Oldest first. `start` is the bucket's first local day, as `YYYY-MM-DD`. */
  by_bucket: (UsageTotals & { start: string })[];
  by_feature: (UsageTotals & { feature: UsageFeature })[];
  /** `by_bucket` split by feature, ordered as both are. */
  by_bucket_feature: (UsageTotals & { start: string; feature: UsageFeature })[];
  by_model: (UsageTotals & { provider: string; model: string })[];
}

/** What `library_report` returns: the state of the index, computed locally. */
export interface LibraryReport {
  libraries: {
    path: string;
    files: number;
    organized: number;
    /** Files with at least one tag. */
    tagged: number;
    failed: number;
    scanned_at: number | null;
  }[];
  /** Files by the part of their MIME type before the slash, `unknown` when there is none. */
  kinds: { mime_group: string; files: number }[];
  top_tags: TagCount[];
  reviews_open: number;
  plans: { applied: number; undone: number; proposed: number };
  /** `hit_rate_30d` is null when nothing was organized in the last 30 days. */
  cache: { answers: number; hit_rate_30d: number | null };
}

/** Which files a change covers: a query, explicit ids, or both. */
type ChangeScope = { query?: FileQuery; file_ids?: number[] };

/** The input of `save_vfolder`. Rule fields left out take the defaults in docs/contracts.md. */
export type SaveVirtualFolder = {
  id?: number;
  name: string;
  parent?: number | null;
  rule: Partial<FolderRule>;
  tag?: Tag | null;
};

/** The rule being built, as `suggest_vfolder_tags` takes it. */
export type VfolderTagQuery = {
  tags: Tag[];
  tag_match: 'any' | 'all';
  exclude_tags?: Tag[];
  folder?: string;
  text?: string;
  limit?: number;
};

/** Why a tag is offered for a rule. See docs/contracts.md#suggesting-folders. */
export type VfolderTagReason = 'narrows' | 'common' | 'favorite' | 'recent';

/** A tag offered for the rule being built. */
export interface VfolderTagSuggestion {
  tag: Tag;
  facet: string | null;
  /** Every file carrying the tag. */
  count: number;
  /** The files the rule matches that carry it. */
  with_rule: number;
  reason: VfolderTagReason;
}

/** What `suggest_vfolder_tags` returns. */
export interface VfolderTagSuggestions {
  /** The rule's total, the same as `search_files` reports. */
  matches: number;
  suggestions: VfolderTagSuggestion[];
}

/** A folder worth saving, as `suggest_vfolders` offers it. */
export interface VfolderSuggestion {
  name: string;
  rule: FolderRule;
  count: number;
  reason: 'large-tag' | 'pair' | 'namespace';
}

/** A saved folder by `id`, or a generated one by its key. */
type FolderRef = { id?: number; generated?: string };
/** Paging and sorting for the files in a virtual folder. */
type FolderPage = Pick<FileQuery, 'hide_dotfiles' | 'sort' | 'order' | 'limit' | 'offset'>;

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
  list_tag_tree: [{ facet?: string; folder?: string }, TagNode[]];
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
  rename_tag: [{ from: Tag; to: Tag; children?: boolean }, Plan];
  move_tag: [{ from: Tag; parent: Tag | null }, Plan];
  apply_plan: [{ id: string }, Job];
  undo_plan: [{ id: string }, Job];
  get_plan: [{ id: string }, Plan];
  discard_plan: [{ id: string }, void];
  list_plans: [{ status?: PlanStatus }, Plan[]];
  list_reviews: [{ tag?: Tag; limit?: number }, ReviewItem[]];
  resolve_reviews: [{ ids: number[]; accept: boolean }, Plan | null];
  suggest_tags: [{ id: number }, ReviewItem[]];
  refresh_candidates: [{ tag: Tag; limit?: number }, RefreshCandidates];
  refresh_tag: [{ tag: Tag; limit?: number; file_ids?: number[] }, Job];
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
  list_vfolders: [{ generated?: boolean }, VirtualFolderTree];
  save_vfolder: [SaveVirtualFolder, VirtualFolder];
  delete_vfolder: [{ id: number }, void];
  vfolder_files: [FolderRef & FolderPage, { files: FileRow[]; total: number; query: FileQuery }];
  add_to_vfolder: [{ id: number; file_ids: number[] }, Plan];
  remove_from_vfolder: [{ id: number; file_ids: number[] }, Plan];
  list_favorite_tags: [Record<string, never>, FavoriteTag[]];
  set_favorite_tag: [{ tag: Tag; favorite: boolean; position?: number }, void];
  usage_report: [
    { since?: number; until?: number; bucket?: 'day' | 'week' | 'month' },
    UsageReport,
  ];
  library_report: [Record<string, never>, LibraryReport];
  suggest_vfolder_tags: [VfolderTagQuery, VfolderTagSuggestions];
  suggest_vfolders: [{ limit?: number }, VfolderSuggestion[]];
}

export type ToolName = keyof ToolMap;
