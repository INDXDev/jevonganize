/** Dev-only fake server, enabled by VITE_MOCK=1. All data is fictional. Never in a production build. */
import type {
  FacetInfo,
  Job,
  ReviewItem,
  ToolMap,
  ToolName,
  VocabularyEntry,
} from '../../types.ts';
import { CONFIG_SCHEMA, initialConfig, merge } from './mock-config.ts';
import { emit } from './mock-events.ts';
import { initialFacets } from './mock-facets.ts';
import { DAY, files, HOME, LIBS, NOW } from './mock-files.ts';
import { find, plans, propose, write } from './mock-plans.ts';
import { detail, df, facetOf, matchCount, search, similar } from './mock-search.ts';
import {
  deleteVfolder,
  listVfolders,
  moveFiles,
  saveVfolder,
  vfolderFiles,
} from './mock-vfolders.ts';

export { fileUrl, thumb } from './mock-assets.ts';
export { chatFetch } from './mock-chat.ts';
export { subscribe } from './mock-events.ts';

const emptyStart = new URLSearchParams(location.search).has('onboarding');

const REVIEW_TAGS: [string, string][] = [
  ['doc-type:invoice', 'Below the apply level'],
  ['topic:finance', 'Below the apply level'],
  ['invoice-state:unpaid', 'Estimated by a chat model'],
  ['flag:sensitive', 'Two facets disagree'],
  ['topic:research', 'New value for an open facet'],
];

let reviews: ReviewItem[] = REVIEW_TAGS.flatMap(([tag, reason], g) =>
  Array.from({ length: [14, 9, 7, 5, 3][g]! }, (_, i): ReviewItem => ({
    id: g * 100 + i + 1,
    file_id: 1 + ((g * 137 + i * 31) % 2000),
    kind: 'suggest',
    tag,
    confidence: i === 4 ? null : 0.84 - i * 0.015 - g * 0.02,
    reason,
  })),
);
reviews = reviews.toSorted(
  (a, b) => a.tag.localeCompare(b.tag) || (b.confidence ?? 0) - (a.confidence ?? 0),
);
reviews.push(
  ...[1, 2, 3].map((n): ReviewItem => ({
    id: 900 + n,
    file_id: 50 * n,
    kind: 'restore',
    tag: 'project:atlas',
    confidence: null,
    reason: 'Restore',
  })),
);

const jobs: Job[] = [];
let libraries = emptyStart ? [] : LIBS;
let hasKey = !emptyStart;
let nextId = 1;

function runJob(kind: Job['kind'], total: number, done?: () => Partial<Job>): Job {
  const job: Job = {
    id: `job-${nextId++}`,
    kind,
    status: 'running',
    started_at: Date.now(),
    done: 0,
    total,
    ...(kind === 'organize' ? { tokens: 0, cost_usd: 0 } : {}),
  };
  jobs.unshift(job);
  const step = Math.ceil(total / 8);
  const timer = setInterval(() => {
    if (job.status !== 'running') return clearInterval(timer);
    job.done = Math.min(total, job.done + step);
    job.current = files[job.done % files.length]!.path;
    if (kind === 'organize') {
      job.tokens = job.done * 3400;
      job.cost_usd = job.done * 0.00035;
    }
    if (job.done === total) {
      clearInterval(timer);
      Object.assign(job, { status: 'done', current: undefined }, done?.());
    }
    emit({ type: 'job', job: { ...job } });
  }, 250);
  return { ...job };
}

let facets = initialFacets;
let config = initialConfig;

const vocabulary: VocabularyEntry[] = [
  { facet: 'topic', value: 'finance', state: 'active' },
  { facet: 'topic', value: 'zeppelins', state: 'proposed' },
];

const librariesNow = () =>
  libraries.map((path) => ({
    path,
    files: files.filter((f) => f.path.startsWith(path)).length,
    taggable: !path.endsWith('Downloads'),
    scanned_at: NOW - DAY,
  }));

const tools: { [K in ToolName]: (input: ToolMap[K][0]) => ToolMap[K][1] } = {
  status: () => ({
    libraries: librariesNow(),
    files: files.length,
    organized: files.filter((f) => f.status === 'organized').length,
    tags: df().size,
    reviews: reviews.length,
    jobs: jobs.map((j) => ({ ...j })),
    provider: 'openai',
    model: 'gpt-6-luna',
    has_key: hasKey,
    keys: hasKey ? ['openai'] : [],
  }),
  list_libraries: librariesNow,
  add_library: ({ path }) => {
    libraries = [...new Set([...libraries, path])];
    return librariesNow().find((l) => l.path === path)!;
  },
  remove_library: ({ path }) => void (libraries = libraries.filter((l) => l !== path)),
  browse_dirs: ({ path = HOME }) => {
    const dirs =
      path === HOME
        ? ['Documents', 'Downloads', 'Pictures']
        : path.endsWith('Documents')
          ? ['Finance', 'Notes', 'Projects']
          : [];
    return {
      path,
      parent: path === HOME ? null : path.slice(0, path.lastIndexOf('/')),
      places: [HOME, `${HOME}/Documents`, `${HOME}/Downloads`, `${HOME}/Pictures`],
      entries: [
        ...dirs.map((name, i) => ({
          name,
          dir: true,
          size: 96,
          modified: Date.UTC(2026, 5 - i, 3),
        })),
        { name: 'invoice-44.pdf', dir: false, size: 48_210, modified: Date.UTC(2026, 3, 9) },
        { name: '.DS_Store', dir: false, size: 6148, modified: Date.UTC(2026, 1, 2) },
      ],
    };
  },

  scan: () => runJob('scan', files.length),
  search_files: search,
  get_file: ({ id }) => detail(id!, reviews),
  similar_files: ({ id, limit }) => similar(id, limit),
  list_tags: ({ folder }) => {
    const counts = new Map<string, number>();
    for (const f of files)
      if (!folder || f.path.startsWith(folder))
        for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts]
      .map(([tag, count]) => ({ tag, facet: facetOf(tag), count }))
      .toSorted((a, b) => b.count - a.count);
  },
  list_folders: ({ folder }) => {
    const below = files.filter((f) => f.path.startsWith(`${folder}/`));
    const names = below.map((f) => f.path.slice(folder.length + 1).split('/'));
    return [...new Set(names.filter((n) => n.length > 1).map((n) => n[0]!))].map((name) => ({
      name,
      path: `${folder}/${name}`,
      files: below.filter((f) => f.path.startsWith(`${folder}/${name}/`)).length,
    }));
  },
  list_facets: () => facets,
  save_facet: (facet) => {
    const next: FacetInfo = { ...facet, enabled: true, custom: true };
    facets = facets.some((f) => f.id === facet.id)
      ? facets.map((f) => (f.id === facet.id ? next : f))
      : [...facets, next];
    return facet;
  },
  delete_facet: ({ id }) => void (facets = facets.filter((f) => f.id !== id)),
  set_enabled: ({ ids, enabled }) =>
    void (facets = facets.map((f) =>
      ids.includes(f.id) || ids.includes(f.pack) ? { ...f, enabled } : f,
    )),
  estimate: ({ query, facets: only }) => {
    const n = matchCount(query);
    return {
      files: n,
      cached: 0,
      facets: only?.length ?? 9,
      tokens: n * 3400,
      cost_usd: n * 0.00035,
      provider: 'openai',
      model: 'gpt-6-luna',
    };
  },
  organize: ({ query }) => {
    return runJob('organize', matchCount(query), () => {
      const made = propose(
        {
          query,
          add: ['doc-date:2026'],
          title: `Organize ${query.folder?.replace(HOME, '~') ?? 'all files'}`,
        },
        'organize',
      );
      return { plan_id: made.id };
    });
  },
  cancel_job: ({ id }) => {
    const job = jobs.find((j) => j.id === id);
    if (job) {
      job.status = 'cancelled';
      emit({ type: 'job', job: { ...job } });
    }
  },
  propose_changes: (input) => propose(input),
  list_vfolders: listVfolders,
  save_vfolder: saveVfolder,
  delete_vfolder: deleteVfolder,
  vfolder_files: vfolderFiles,
  add_to_vfolder: (input) => moveFiles(input, true),
  remove_from_vfolder: (input) => moveFiles(input, false),
  rename_tag: ({ from, to }) =>
    propose(
      { query: { tags: [from] }, add: [to], remove: [from], title: `Rename ${from} to ${to}` },
      'cleanup',
    ),
  apply_plan: ({ id }) => {
    const target = find(id);
    if (target.status !== 'proposed') throw new Error('This plan is not proposed');
    target.status = 'applied';
    return runJob('apply', Math.max(target.summary.files, 1), () => (write(target), {}));
  },
  undo_plan: ({ id }) => {
    const target = find(id);
    target.status = 'undone';
    return runJob('undo', Math.max(target.summary.files, 1), () => (write(target, true), {}));
  },
  get_plan: ({ id }) => find(id),
  discard_plan: ({ id }) => void plans.splice(plans.indexOf(find(id)), 1),
  list_plans: ({ status }) =>
    plans.filter((p) => !status || p.status === status).map((p) => ({ ...p, ops: [] })),
  list_reviews: ({ tag, limit }) => reviews.filter((r) => !tag || r.tag === tag).slice(0, limit),
  resolve_reviews: ({ ids, accept }) => {
    const items = reviews.filter((r) => ids.includes(r.id));
    reviews = reviews.filter((r) => !ids.includes(r.id));
    emit({ type: 'reviews', count: reviews.length });
    if (!accept || !items.length) return null;
    const made = propose({
      file_ids: items.map((r) => r.file_id),
      add: [...new Set(items.map((r) => r.tag))],
      title: 'Accepted review items',
    });
    return made;
  },
  suggest_tags: () => [],
  refresh_candidates: ({ tag, limit = 50 }) => {
    const candidates = files
      .filter((f) => !f.tags.includes(tag))
      .slice(0, Math.min(limit, 12))
      .map((f, i) => ({
        ...f,
        score: 0.9 - i * 0.05,
        signals: {
          terms: ['invoice', 'total'].slice(0, 1 + (i % 2)),
          tags: i % 3 === 0 ? ['party:acme'] : [],
          similar: i % 2 ? 0.4 : 0,
          name: i % 4 === 0,
        },
      }));
    return {
      tag,
      tagged: 14,
      seeds: 14,
      terms: ['invoice', 'total', 'due'],
      tags: ['party:acme'],
      candidates,
      checked: 3,
      estimate: {
        files: candidates.length,
        cached: 0,
        facets: 1,
        tokens: candidates.length * 2100,
        cost_usd: candidates.length * 0.0002,
        provider: 'openai',
        model: 'gpt-6-luna',
      },
    };
  },
  refresh_tag: ({ tag, file_ids = [] }) =>
    runJob('refresh', Math.max(file_ids.length, 1), () => ({
      tag,
      reviews: Math.ceil(file_ids.length / 3),
    })),
  search_catalog: ({ text }) =>
    [
      'finance/budgeting',
      'finance/invoices',
      'finance/tax-returns',
      'technology/machine-learning',
    ].filter((v) => v.includes(text)),
  pick_topics: () => ({
    topics: Array.from({ length: 100 }, (_, i) => ({
      value: `finance/topic-${i}`,
      probability: 0.97,
    })),
    files: 12,
    tokens: 250_000,
    cost_usd: 0.025,
  }),
  list_vocabulary: ({ facet }) => vocabulary.filter((v) => !facet || v.facet === facet),
  set_vocabulary: ({ facet, value, state }) => {
    const entry = vocabulary.find((v) => v.facet === facet && v.value === value);
    if (entry) entry.state = state;
  },
  cleanup_report: () => ({
    near_duplicates: [
      { tags: ['topic:finance', 'topic:finances'], files: 23 },
      { tags: ['vendor:lumen-co', 'vendor:lumen'], files: 8 },
    ],
    single_use: [
      { tag: 'topic:zeppelins', facet: 'topic', count: 1 },
      { tag: 'place:reykjavik', facet: 'place', count: 1 },
    ],
    over_broad: [{ tag: 'topic:finance', facet: 'topic', count: 812 }],
  }),
  get_config: () => ({
    config,
    system_language: 'en',
    schema: CONFIG_SCHEMA,
    paths: {
      config: `${HOME}/.config/jevonganize/config.toml`,
      data: `${HOME}/.local/share/jevonganize/index.db`,
      cache: `${HOME}/.cache/jevonganize/thumbnails`,
    },
  }),
  set_config: (patch) => {
    const review = (patch.thresholds as { review?: number } | undefined)?.review;
    if (review !== undefined && review > 1) throw new Error('thresholds.review must be at most 1');
    return (config = merge(config, patch));
  },
  list_keys: () => ({
    keys: [{ provider: 'openai', source: hasKey ? 'file' : null, in_env: true }],
    env_allowed: null,
  }),
  set_api_key: () => void (hasKey = true),
  remove_api_key: () => {
    const removed = hasKey;
    hasKey = false;
    return { removed };
  },
  set_env_keys: () => {},
  reveal_file: () => {},
  open_file: () => {},
  doctor: () => [{ name: 'runtime', ok: true, detail: 'Node 24' }],
};

/** Stands in for `POST /api/call/:tool`, with a little latency. */
export async function call<K extends ToolName>(
  tool: K,
  input: ToolMap[K][0],
): Promise<ToolMap[K][1]> {
  await new Promise((resolve) => setTimeout(resolve, 15));
  return structuredClone((tools[tool] as (i: unknown) => unknown)(input)) as ToolMap[K][1];
}
