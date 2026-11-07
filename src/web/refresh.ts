/** Which cached reads a write can change, so that one edit does not refetch every open query. */
import type { ToolName } from '../types.ts';

const PLANS: ToolName[] = ['status', 'list_plans', 'get_plan'];
const KEYS: ToolName[] = ['list_keys', 'status', 'doctor', 'estimate', 'get_config'];
const FACETS: ToolName[] = ['list_facets', 'status', 'estimate', 'get_config'];
const VFOLDERS: ToolName[] = ['list_vfolders', 'vfolder_files'];

/**
 * A job's own reads refresh when it ends, in `onEvent`. A write missing here refreshes everything,
 * so a new tool is merely slow until it is listed.
 */
const REFRESHED: Partial<Record<ToolName, ToolName[]>> = {
  reveal_file: [],
  open_file: [],
  scan: PLANS,
  organize: PLANS,
  apply_plan: PLANS,
  undo_plan: PLANS,
  cancel_job: PLANS,
  discard_plan: PLANS,
  propose_changes: PLANS,
  rename_tag: PLANS,
  suggest_tags: ['list_reviews', 'get_file', 'status'],
  refresh_tag: ['status', 'list_reviews'],
  resolve_reviews: [...PLANS, 'list_reviews', 'get_file', 'list_tags', 'cleanup_report'],
  set_vocabulary: ['list_vocabulary', 'list_tags', ...FACETS],
  set_enabled: FACETS,
  save_facet: FACETS,
  delete_facet: FACETS,
  set_config: FACETS,
  set_api_key: KEYS,
  remove_api_key: KEYS,
  set_env_keys: KEYS,
  save_vfolder: VFOLDERS,
  delete_vfolder: VFOLDERS,
  add_to_vfolder: PLANS,
  remove_from_vfolder: PLANS,
};

/** The reads to refetch after `tool`, or `undefined` for all of them. */
export const refreshedBy = (tool: ToolName): ToolName[] | undefined => REFRESHED[tool];

/** What a finished job can have changed, whichever kind it was. */
export const JOB_READS: ToolName[] = [
  'status',
  'list_plans',
  'get_plan',
  'list_libraries',
  'list_folders',
  'search_files',
  'get_file',
  'similar_files',
  'list_tags',
  'list_reviews',
  'cleanup_report',
  'estimate',
  'refresh_candidates',
  'list_vfolders',
  'vfolder_files',
];
