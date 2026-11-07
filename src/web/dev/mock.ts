/** Dev-only fake server, enabled by VITE_MOCK=1. All data is fictional. Never in a production build. */
import type { ToolMap, ToolName } from '../../tool-map.ts';
import {
  cleanupReport,
  listVocabulary,
  MODEL,
  pickTopics,
  refreshCandidates,
  searchCatalog,
  setVocabulary,
} from './mock-catalog.ts';
import { chatFetch as scriptedChat } from './mock-chat.ts';
import { CONFIG_SCHEMA, initialConfig, merge } from './mock-config.ts';
import { deleteFacet, listFacets, saveFacet, setEnabled } from './mock-facets.ts';
import { files, HOME } from './mock-files.ts';
import { cancelJob, COST_PER_FILE_USD, jobs, runJob, TOKENS_PER_FILE } from './mock-jobs.ts';
import { libraryReport, listFavoriteTags, setFavoriteTag, usageReport } from './mock-reports.ts';
import {
  addLibrary,
  browseDirs,
  emptyStart,
  listFolders,
  listLibraries,
  listTags,
  removeLibrary,
} from './mock-library.ts';
import {
  applyPlan,
  discardPlan,
  findPlan,
  listPlans,
  propose,
  renameTag,
  undoPlan,
} from './mock-plans.ts';
import { listReviews, openReviews, resolveReviews } from './mock-reviews.ts';
import { listTagTree, moveTag } from './mock-tag-tree.ts';
import {
  fileDetail,
  countFilesPerTag,
  countMatchingFiles,
  searchFiles,
  similarFiles,
} from './mock-search.ts';
import {
  deleteVfolder,
  listVfolders,
  moveFiles,
  saveVfolder,
  vfolderFiles,
} from './mock-vfolders.ts';
import { suggestVfolders, suggestVfolderTags } from './mock-vfolder-suggest.ts';

export { fileUrl, thumb } from './mock-assets.ts';
export { subscribe } from './mock-events.ts';

/** Set by the web demo's build (`webdemo/`): a read-only tour, for showing the UI to people. */
const demo = import.meta.env.VITE_DEMO === '1';
/** What the demo refuses: every tool with `writes` or `approval` in the tool table. */
const DEMO_REFUSED = new Set<ToolName>([
  'add_library',
  'remove_library',
  'scan',
  'save_facet',
  'delete_facet',
  'set_enabled',
  'pick_topics',
  'organize',
  'cancel_job',
  'propose_changes',
  'rename_tag',
  'apply_plan',
  'undo_plan',
  'discard_plan',
  'resolve_reviews',
  'suggest_tags',
  'set_vocabulary',
  'refresh_tag',
  'set_config',
  'set_api_key',
  'remove_api_key',
  'set_env_keys',
  'save_vfolder',
  'delete_vfolder',
  'add_to_vfolder',
  'remove_from_vfolder',
  'set_favorite_tag',
  'move_tag',
]);
const DEMO_MESSAGE = 'This web demo is read-only: it changes no tags and calls no model.';

/** Stands in for `POST /api/chat`. The demo answers with a refusal instead of the scripted chat. */
export const chatFetch: typeof fetch = demo
  ? async () => new Response(DEMO_MESSAGE, { status: 403 })
  : scriptedChat;

/** The facet count an estimate reports when the run names none. */
const DEFAULT_FACET_COUNT = 9;
/** Stands in for the server's round trip, so loading states show for a moment. */
const LATENCY_MS = 15;

let config = initialConfig;
let hasKey = !emptyStart;

const status = (): ToolMap['status'][1] => ({
  libraries: listLibraries(),
  files: files.length,
  organized: files.filter((file) => file.status === 'organized').length,
  tags: countFilesPerTag().size,
  reviews: openReviews().length,
  jobs: jobs.map((job) => ({ ...job })),
  ...MODEL,
  has_key: hasKey,
  keys: hasKey ? ['openai'] : [],
});

const estimate = ({ query, facets: chosen }: ToolMap['estimate'][0]) => {
  const fileCount = countMatchingFiles(query);
  return {
    files: fileCount,
    cached: 0,
    facets: chosen?.length ?? DEFAULT_FACET_COUNT,
    tokens: fileCount * TOKENS_PER_FILE,
    cost_usd: fileCount * COST_PER_FILE_USD,
    ...MODEL,
  };
};

/** Stands in for `organize`: when the job ends, it proposes a plan that dates every file. */
const organize = ({ query }: ToolMap['organize'][0]) =>
  runJob('organize', countMatchingFiles(query), () => {
    const folderName = query.folder?.replace(HOME, '~') ?? 'all files';
    const plan = propose(
      { query, add: ['doc-date:2026'], title: `Organize ${folderName}` },
      'organize',
    );
    return { plan_id: plan.id };
  });

const getConfig = (): ToolMap['get_config'][1] => ({
  config,
  system_language: 'en',
  schema: CONFIG_SCHEMA,
  paths: {
    config: `${HOME}/.config/jevonganize/config.toml`,
    data: `${HOME}/.local/share/jevonganize/index.db`,
    cache: `${HOME}/.cache/jevonganize/thumbnails`,
  },
});

/** Stands in for `set_config`, with one check, so the settings screen can show a refusal. */
function setConfig(patch: ToolMap['set_config'][0]) {
  const review = (patch.thresholds as { review?: number } | undefined)?.review;
  if (review !== undefined && review > 1) throw new Error('thresholds.review must be at most 1');
  config = merge(config, patch);
  return config;
}

/** Stands in for `refresh_tag`: about a third of the files checked end up in review. */
const refreshTag = ({ tag, file_ids = [] }: ToolMap['refresh_tag'][0]) =>
  runJob('refresh', Math.max(file_ids.length, 1), () => ({
    tag,
    reviews: Math.ceil(file_ids.length / 3),
  }));

function setApiKey() {
  hasKey = true;
}

function removeApiKey() {
  const removed = hasKey;
  hasKey = false;
  return { removed };
}

const tools: { [K in ToolName]: (input: ToolMap[K][0]) => ToolMap[K][1] } = {
  status,
  list_libraries: listLibraries,
  add_library: addLibrary,
  remove_library: removeLibrary,
  browse_dirs: browseDirs,
  scan: () => runJob('scan', files.length),
  search_files: searchFiles,
  get_file: ({ id }) => fileDetail(id!, openReviews()),
  similar_files: ({ id, limit }) => similarFiles(id, limit),
  list_tags: listTags,
  list_tag_tree: listTagTree,
  list_folders: listFolders,
  list_facets: listFacets,
  save_facet: saveFacet,
  delete_facet: deleteFacet,
  set_enabled: setEnabled,
  estimate,
  organize,
  cancel_job: ({ id }) => cancelJob(id),
  propose_changes: (input) => propose(input),
  list_vfolders: listVfolders,
  save_vfolder: saveVfolder,
  delete_vfolder: deleteVfolder,
  vfolder_files: vfolderFiles,
  add_to_vfolder: (input) => moveFiles(input, true),
  remove_from_vfolder: (input) => moveFiles(input, false),
  suggest_vfolder_tags: suggestVfolderTags,
  suggest_vfolders: suggestVfolders,
  rename_tag: renameTag,
  move_tag: moveTag,
  apply_plan: applyPlan,
  undo_plan: undoPlan,
  get_plan: ({ id }) => findPlan(id),
  discard_plan: discardPlan,
  list_plans: listPlans,
  list_reviews: listReviews,
  resolve_reviews: resolveReviews,
  suggest_tags: () => [],
  refresh_candidates: refreshCandidates,
  refresh_tag: refreshTag,
  search_catalog: searchCatalog,
  pick_topics: pickTopics,
  list_vocabulary: listVocabulary,
  set_vocabulary: setVocabulary,
  cleanup_report: cleanupReport,
  get_config: getConfig,
  set_config: setConfig,
  list_keys: () => ({
    keys: [{ provider: 'openai', source: hasKey ? 'file' : null, in_env: true }],
    env_allowed: null,
  }),
  set_api_key: setApiKey,
  remove_api_key: removeApiKey,
  set_env_keys: () => {},
  reveal_file: () => {},
  open_file: () => {},
  doctor: () => [{ name: 'runtime', ok: true, detail: 'Node 24' }],
  list_favorite_tags: listFavoriteTags,
  set_favorite_tag: setFavoriteTag,
  usage_report: usageReport,
  library_report: libraryReport,
};

/** Stands in for `POST /api/call/:tool`, with a little latency. */
export async function call<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
): Promise<ToolMap[K][1]> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (demo && DEMO_REFUSED.has(tool)) throw new Error(DEMO_MESSAGE);
  const run = tools[tool] as (input: unknown) => unknown;
  // A copy, as a real response would be, so a view cannot change the mock's state by mutating it.
  return structuredClone(run(input)) as ToolMap[K][1];
}
