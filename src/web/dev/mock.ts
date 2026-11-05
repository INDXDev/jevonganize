/** Dev-only fake server, enabled by VITE_MOCK=1. All data is fictional. Never in a production build. */
import type {
  Facet,
  FacetInfo,
  FileDetail,
  FileQuery,
  FileRow,
  Job,
  Plan,
  ReviewItem,
  ServerEvent,
  SimilarFile,
  ToolMap,
  ToolName,
} from '../../types.ts';

const DOCX =
  'UEsDBBQAAAAIAEYKZl3mdcR+0gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvVLDMAzHX8XnlasVGBh6SToAKzD0BXSOkvjw11luad++Sls6cIVR+n/8ZLebQ/BqT4Vdip1+NI3e9O32mImVKJE7Pdea1wBsZwrIJmWKooypBKwylgky2i+cCJ6a5hlsipViXdWlQ/ftK42481W9HWR9oRTyrNXLxbiwOo05e2exig77OPyirK4EI8mzh2eX+UEMGu4SFuVvwDX3Ic8ubiD1iaW+YxAXfKcywJDsLkjS/F9z5840js7SLb+05ZIsMbs4BW9uSkAXf+6H83f3J1BLAwQUAAAACABGCmZdXzOVUpUAAAAHAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0Q+QJ0yMKCmXVi6Ii4QJW5T0TzkhNftycBAEQOjf//6LHfDw6/iRpyXGBS0jYSh70606lKD7JaURW2ErMCVkg6I2TjyOjcxUaibKbLXpY48Y9LmomfCnZR75E8DtqYYrQIebQvi/Ez0jx2naTF0jObqKZQfJ74aVdY8U1Fwj2zRvuOmsoB9h5sX+xdQSwMEFAAAAAgARgpmXfiqNy/VAAAAUgEAABEAAAB3b3JkL2RvY3VtZW50LnhtbG1QMW7DMAz8CuEHWG6HDoajbB0KBOjQD9ASKwu1KEFi7DSvj+ygKQp0ucPxiMORw/ESZlgoFx/50Dy1XXPUw9rbaM6BWKDaXPr10EwiqVeqmIkCljYm4up9xhxQqsxOrTHblKOhUjy7MKvnrntRAT03W+QY7ffGaYO8w/tOo9KDeijRJyKpAcBRqGyO3P0d098I0a/eSO2OMxQMaSZ4VK/dQCaCN1oiO2R/JQjRfLXwUadCGABdJrL71ni2jgSQ75LpIpBp8bSCRaH2nyLq5yj1+zB9A1BLAQIUAxQAAAAIAEYKZl3mdcR+0gAAAIsBAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgARgpmXV8zlVKVAAAABwEAAAsAAAAAAAAAAAAAAIABAwEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgARgpmXfiqNy/VAAAAUgEAABEAAAAAAAAAAAAAAIABwQEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAMUCAAAAAA==';

let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

const HOME = '/Users/mika';
const LIBS = [`${HOME}/Documents`, `${HOME}/Pictures`, `${HOME}/Downloads`];
const VENDORS = ['northwind', 'lumen-co', 'harbor-labs', 'fennel', 'kestrel-print', 'oakline'];
const PROJECTS = ['atlas', 'tidewater', 'juniper', 'meridian'];
const PLACES = ['kyoto', 'lisbon', 'oslo', 'home', 'studio'];
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 9, 30);

type Kind = { dir: string; ext: string; mime: string; make(i: number): [string, string[]] };

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const KINDS: Kind[] = [
  {
    dir: 'Documents/Finance/Invoices',
    ext: 'pdf',
    mime: 'application/pdf',
    make: (i) => {
      const v = pick(VENDORS);
      return [
        `invoice-${v}-${1000 + i}`,
        [
          'doc-type:invoice',
          `vendor:${v}`,
          'topic:finance',
          pick(['invoice-state:paid', 'invoice-state:unpaid']),
        ],
      ];
    },
  },
  {
    dir: 'Documents/Finance/Receipts',
    ext: 'pdf',
    mime: 'application/pdf',
    make: (i) => {
      const v = pick(VENDORS);
      return [`receipt-${v}-${i}`, ['doc-type:receipt', `vendor:${v}`, 'topic:finance/expenses']];
    },
  },
  {
    dir: 'Documents/Tax',
    ext: 'pdf',
    mime: 'application/pdf',
    make: (i) => [
      `tax-statement-${i}`,
      ['doc-type:statement', 'topic:finance/tax', 'flag:sensitive'],
    ],
  },
  {
    dir: 'Documents/Contracts',
    ext: 'docx',
    mime: DOCX_MIME,
    make: (i) => {
      const v = pick(VENDORS);
      return [
        `agreement-${v}-${i}`,
        ['doc-type:contract', `vendor:${v}`, 'topic:legal', 'flag:sensitive'],
      ];
    },
  },
  {
    dir: 'Documents/Notes',
    ext: 'md',
    mime: 'text/markdown',
    make: (i) => {
      const p = pick(PROJECTS);
      return [
        `notes-${p}-${i}`,
        ['doc-type:notes', `project:${p}`, pick(['topic:planning', 'topic:research'])],
      ];
    },
  },
  {
    dir: 'Documents/Projects',
    ext: 'docx',
    mime: DOCX_MIME,
    make: (i) => {
      const p = pick(PROJECTS);
      return [`brief-${p}-v${(i % 5) + 1}`, ['doc-type:report', `project:${p}`, 'topic:planning']];
    },
  },
  {
    dir: 'Documents/Projects',
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    make: (i) => {
      const p = pick(PROJECTS);
      return [`budget-${p}-${i}`, ['doc-type:spreadsheet', `project:${p}`, 'topic:finance']];
    },
  },
  {
    dir: 'Pictures/Trips',
    ext: 'jpg',
    mime: 'image/jpeg',
    make: (i) => {
      const p = pick(PLACES);
      return [
        `IMG_${pad(2000 + i, 4)}`,
        [
          'media:photo',
          `place:${p}`,
          pick(['subject:landscape', 'subject:street', 'subject:food', 'subject:people']),
        ],
      ];
    },
  },
  {
    dir: 'Pictures/Screenshots',
    ext: 'png',
    mime: 'image/png',
    make: (i) => [
      `screenshot-${i}`,
      ['media:screenshot', pick(['topic:research', 'topic:planning'])],
    ],
  },
  {
    dir: 'Downloads',
    ext: 'zip',
    mime: 'application/zip',
    make: (i) => [`archive-${i}`, ['doc-type:archive']],
  },
  {
    dir: 'Downloads',
    ext: 'mp3',
    mime: 'audio/mpeg',
    make: (i) => [`voice-memo-${i}`, ['media:audio', 'topic:research']],
  },
  {
    dir: 'Downloads',
    ext: 'mp4',
    mime: 'video/mp4',
    make: (i) => [`clip-${i}`, ['media:video', `place:${pick(PLACES)}`]],
  },
];

const WEIGHTS = [6, 5, 2, 2, 4, 2, 2, 12, 3, 1, 1, 1];
const bag = KINDS.flatMap((k, i) => Array.from({ length: WEIGHTS[i]! }, () => k));

const emptyStart = new URLSearchParams(location.search).has('onboarding');

const files: FileRow[] = Array.from({ length: 2000 }, (_, i) => {
  const kind = pick(bag);
  const [stem, tags] = kind.make(i);
  const mtime = NOW - Math.floor(rnd() * 900) * DAY;
  const roll = rnd();
  const year = `doc-date:${new Date(mtime).getUTCFullYear()}`;
  const name = `${stem}.${kind.ext}`;
  return {
    id: i + 1,
    name,
    path: `${HOME}/${kind.dir}/${name}`,
    size: Math.floor(20_000 + rnd() * rnd() * 9_000_000),
    mtime_ms: mtime,
    mime: kind.mime,
    tags: roll < 0.08 ? [] : [...tags, year].toSorted(),
    status: roll < 0.08 ? 'new' : roll < 0.095 ? 'failed' : 'organized',
  };
});

const facetOf = (tag: string) => (tag.includes(':') ? tag.split(':')[0]! : null);

function base(
  id: string,
  pack: string,
  title: string,
  kind: Facet['kind'],
  extra: Partial<Facet> = {},
): FacetInfo {
  return {
    id,
    pack,
    title,
    kind,
    applies_to: [],
    weight: 1,
    enabled: pack !== 'finance',
    custom: false,
    ...extra,
  };
}

let facets: FacetInfo[] = [
  base('doc-type', 'core', 'Document type', 'choice', {
    instructions: 'What kind of document is this?',
    values: {
      invoice: 'It asks for payment for goods or services.',
      receipt: 'It proves a payment was made.',
      contract: 'It sets out terms that parties agreed.',
      notes: 'Informal notes.',
    },
  }),
  base('topic', 'core', 'Topic', 'multi', {
    instructions: 'What is it about?',
    open: true,
    values: {
      finance: 'Money, accounts, budgets.',
      legal: 'Law and agreements.',
      research: 'Reading and findings.',
      planning: 'Plans and schedules.',
    },
  }),
  base('doc-date', 'time', 'Document date', 'date', {
    instructions: 'What date does the document itself carry?',
    precision: 'year',
  }),
  base('author', 'time', 'Author', 'field', { field: 'author', weight: 0.5 }),
  base('sensitive', 'sensitivity', 'Sensitive', 'flag', {
    instructions: 'Does it hold personal or financial details?',
    weight: 0.3,
  }),
  base('confidentiality', 'sensitivity', 'Confidentiality', 'level', {
    instructions: 'How widely could this be shared?',
    levels: ['public', 'internal', 'restricted'],
  }),
  base('media', 'media', 'Media kind', 'choice', {
    instructions: 'What kind of media is this?',
    applies_to: ['image/*', 'audio/*', 'video/*'],
    values: {
      photo: 'A camera photo.',
      screenshot: 'A capture of a screen.',
      audio: 'A sound recording.',
      video: 'A moving picture.',
    },
  }),
  base('subject', 'media', 'Subject', 'choice', {
    instructions: 'What does the image show?',
    applies_to: ['image/*'],
    values: {
      landscape: 'Open scenery.',
      street: 'Streets and buildings.',
      food: 'Food or drink.',
      people: 'People.',
    },
  }),
  base('invoice-state', 'finance', 'Invoice state', 'choice', {
    instructions: 'What is the payment state of this invoice?',
    applies_to: ['application/*', 'image/*'],
    values: {
      paid: 'It shows the invoice was paid: a receipt, or a paid stamp.',
      unpaid: 'It asks for payment that is still due.',
    },
  }),
  base('amount', 'finance', 'Amount band', 'level', {
    instructions: 'How large is the total?',
    levels: ['small', 'medium', 'large'],
    apply_above: 0.9,
  }),
];

const plan = (
  id: string,
  title: string,
  source: Plan['source'],
  status: Plan['status'],
  ago: number,
  added: Record<string, number>,
  removed: Record<string, number> = {},
): Plan => {
  const count = Math.max(...Object.values({ ...added, ...removed }));
  return {
    id,
    title,
    source,
    status,
    created_at: NOW - ago,
    ops: files
      .slice(0, count)
      .map((f) => ({ file_id: f.id, add: Object.keys(added), remove: Object.keys(removed) })),
    summary: { files: count, added, removed },
  };
};

const plans: Plan[] = [
  plan('7f3a9c21', 'Organize ~/Downloads', 'organize', 'proposed', 12 * 60_000, {
    'doc-type:invoice': 214,
    'topic:finance': 187,
    'doc-date:2026': 312,
    'media:screenshot': 64,
    'vendor:northwind': 41,
  }),
  plan('c04e11b8', 'Tag 2026 tax statements', 'mcp', 'proposed', 47 * 60_000, {
    'topic:finance/tax': 61,
  }),
  plan(
    'a91d3e07',
    'Rename doc-type:bill to doc-type:invoice',
    'cleanup',
    'applied',
    3 * 3600_000,
    { 'doc-type:invoice': 88 },
    { 'doc-type:bill': 88 },
  ),
  plan('5be2707f', 'Organize ~/Pictures/Trips', 'organize', 'applied', 26 * 3600_000, {
    'media:photo': 640,
    'place:kyoto': 122,
    'subject:street': 201,
  }),
  plan(
    '19c0ffd2',
    'Remove topic:misc from Archive',
    'chat',
    'undone',
    50 * 3600_000,
    {},
    { 'topic:misc': 37 },
  ),
  {
    ...plan('e3307ab1', 'Organize ~/Documents/Scans', 'organize', 'failed', 72 * 3600_000, {
      'doc-type:receipt': 9,
    }),
    errors: { 12: 'Volume is read only', 40: 'File changed during apply' },
  },
];

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

const listeners = new Set<(event: ServerEvent) => void>();
const emit = (event: ServerEvent) => listeners.forEach((l) => l(event));

/** Stands in for `/api/events`. */
export function subscribe(listener: (event: ServerEvent) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const jobs: Job[] = [];
let libraries = emptyStart ? [] : LIBS;
let hasKey = !emptyStart;
let nextId = 1;

function runJob(kind: Job['kind'], total: number, done?: () => Partial<Job>): Job {
  const job: Job = {
    id: `job-${nextId++}`,
    kind,
    status: 'running',
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

function matches(file: FileRow, q: FileQuery) {
  const tagged = (tag: string) => file.tags.some((t) => t === tag || t.startsWith(`${tag}/`));
  if (q.folder && !file.path.startsWith(q.folder)) return false;
  if (q.text && !`${file.name} ${file.tags.join(' ')}`.toLowerCase().includes(q.text.toLowerCase()))
    return false;
  if (q.tags && !q.tags.every(tagged)) return false;
  if (q.exclude_tags?.some(tagged)) return false;
  if (
    q.mime &&
    !(q.mime.endsWith('*') ? file.mime?.startsWith(q.mime.slice(0, -1)) : file.mime === q.mime)
  )
    return false;
  return !q.status || file.status === q.status;
}

function search(q: FileQuery) {
  const sign = q.order === 'asc' ? 1 : -1;
  const sorted = files
    .filter((f) => matches(f, q))
    .toSorted((a, b) => {
      if (q.sort === 'name') return sign * a.name.localeCompare(b.name);
      if (q.sort === 'size') return sign * (a.size - b.size);
      return sign * (a.mtime_ms - b.mtime_ms);
    });
  const offset = q.offset ?? 0;
  return { files: sorted.slice(offset, offset + (q.limit ?? 50)), total: sorted.length };
}

const df = () => {
  const counts = new Map<string, number>();
  for (const f of files) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
};

function similar(id: number, limit = 12): SimilarFile[] {
  const counts = df();
  const idf = (t: string) => Math.log(1 + files.length / (counts.get(t) ?? 1));
  const sum = (list: Iterable<string>) => [...list].reduce((n, t) => n + idf(t), 0);
  const self = files[id - 1]!;
  const mine = new Set(self.tags);
  return files
    .filter((f) => f.id !== id)
    .map((f) => {
      const shared = f.tags.filter((t) => mine.has(t));
      const union = new Set([...f.tags, ...self.tags]);
      return { ...f, shared, score: union.size ? sum(shared) / sum(union) : 0 };
    })
    .filter((f) => f.shared.length)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);
}

function detail(id: number): FileDetail {
  const file = files[id - 1];
  if (!file) throw new Error(`No file ${id}`);
  return {
    ...file,
    metadata: file.mime?.startsWith('image/')
      ? { width: 4032, height: 3024, camera: 'Fictional F2', iso: 200 }
      : { author: 'Mika Tanaka', pages: 1 + (id % 9), title: file.name.split('.')[0]! },
    answers: file.tags
      .filter((t) => t.includes(':'))
      .map((t, i) => ({
        facet: facetOf(t)!,
        value: t.split(':')[1]!,
        confidence: i === 2 ? null : 0.98 - i * 0.03,
        estimated: i === 1,
        refused: false,
      })),
    reviews: reviews.filter((r) => r.file_id === id),
    taggable: !file.path.includes('/Downloads/'),
  };
}

function propose(input: ToolMap['propose_changes'][0], source: Plan['source'] = 'user'): Plan {
  const targets =
    input.file_ids ?? search({ ...input.query, limit: 1e6, offset: 0 }).files.map((f) => f.id);
  const add = input.add ?? [];
  const remove = input.remove ?? [];
  const next: Plan = {
    id: Math.floor(rnd() * 2 ** 32)
      .toString(16)
      .padStart(8, '0'),
    title: input.title,
    source,
    status: 'proposed',
    created_at: Date.now(),
    ops: targets.map((file_id) => ({ file_id, add, remove })),
    summary: {
      files: targets.length,
      added: Object.fromEntries(add.map((t) => [t, targets.length])),
      removed: Object.fromEntries(remove.map((t) => [t, targets.length])),
    },
  };
  plans.unshift(next);
  return next;
}

function write(target: Plan, reverse = false) {
  for (const op of target.ops) {
    const file = files[op.file_id - 1];
    if (!file) continue;
    const add = reverse ? op.remove : op.add;
    const remove = reverse ? op.add : op.remove;
    file.tags = [...new Set([...file.tags, ...add])].filter((t) => !remove.includes(t)).toSorted();
  }
  emit({ type: 'files', ids: target.ops.map((o) => o.file_id) });
}

const find = (id: string) => {
  const found = plans.find((p) => p.id === id);
  if (!found) throw new Error(`No plan ${id}`);
  return found;
};

const int = (minimum?: number, maximum?: number, description?: string) => ({
  type: 'integer',
  minimum,
  maximum,
  description,
});

const SCHEMA = (() => {
  const provider = {
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
  return {
    type: 'object',
    properties: {
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
      provider,
      profiles: { type: 'object', additionalProperties: provider },
      chat: provider,
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
          apply: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'At or above: joins the plan.',
          },
          review: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'At or above: review queue. Below: dropped.',
          },
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
})();

let config: Record<string, unknown> = {
  port: 48620,
  concurrency: 8,
  max_tags: 10,
  fiscal_year_start: 4,
  exclude: ['node_modules', '.git', '*.tmp'],
  send_images: true,
  provider: { name: 'openai', model: 'gpt-6-luna' },
  profiles: {},
  chat: { name: 'openai', model: 'gpt-6-luna' },
  facets: { enabled: ['core', 'time', 'sensitivity', 'media'], disabled: [] },
  thresholds: { apply: 0.85, review: 0.5, estimated_to_review: true },
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

const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries([
    ...Object.entries(a),
    ...Object.entries(b).map(([k, v]) => [
      k,
      v && typeof v === 'object' && !Array.isArray(v)
        ? merge((a[k] ?? {}) as Record<string, unknown>, v as Record<string, unknown>)
        : v,
    ]),
  ]);

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
  browse_dirs: ({ path = HOME }) => ({
    path,
    parent: path === HOME ? null : path.slice(0, path.lastIndexOf('/')),
    dirs:
      path === HOME
        ? ['Documents', 'Downloads', 'Pictures']
        : path.endsWith('Documents')
          ? ['Finance', 'Notes', 'Projects']
          : [],
  }),
  scan: () => runJob('scan', files.length),
  search_files: search,
  get_file: ({ id }) => detail(id!),
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
    const n = Math.min(query.limit ?? Infinity, files.filter((f) => matches(f, query)).length);
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
    const n = Math.min(query.limit ?? Infinity, files.filter((f) => matches(f, query)).length);
    return runJob('organize', n, () => {
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
  set_vocabulary: () => {},
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
  get_config: () => ({ config, schema: SCHEMA }),
  set_config: (patch) => {
    const review = (patch.thresholds as { review?: number } | undefined)?.review;
    if (review !== undefined && review > 1) throw new Error('thresholds.review must be at most 1');
    return (config = merge(config, patch));
  },
  set_api_key: () => void (hasKey = true),
  reveal_file: () => {},
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

const hue = (id: number) => (id * 47) % 360;

function imageSvg(file: FileRow) {
  const h = hue(file.id);
  const sky = `hsl(${h} 45% ${28 + (file.id % 30)}%)`;
  const low = `hsl(${(h + 40) % 360} 50% 62%)`;
  const land = `hsl(${(h + 180) % 360} 22% 16%)`;
  const y = 120 + (file.id % 50);
  const sun = 40 + ((file.id * 13) % 240);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${low}"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><circle cx="${sun}" cy="${y - 50}" r="20" fill="hsl(${h} 80% 86%)" opacity=".85"/><path d="M0 ${y}L60 ${y - 34}L120 ${y + 8}L190 ${y - 46}L250 ${y + 2}L320 ${y - 24}V240H0Z" fill="${land}" opacity=".7"/><path d="M0 ${y + 40}Q90 ${y + 8} 170 ${y + 44}T320 ${y + 30}V240H0Z" fill="${land}"/></svg>`;
}

function shotSvg(file: FileRow) {
  const bars = Array.from(
    { length: 7 },
    (_, i) =>
      `<rect x="${86 + (i % 2) * 12}" y="${38 + i * 24}" width="${90 + ((file.id * (i + 3)) % 130)}" height="9" rx="2" fill="#3a3e46"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice"><rect width="320" height="240" fill="#16181c"/><rect width="320" height="20" fill="#24262b"/><circle cx="12" cy="10" r="3" fill="#71757e"/><circle cx="24" cy="10" r="3" fill="#71757e"/><rect y="20" width="70" height="220" fill="#1b1d21"/>${bars}</svg>`;
}

function pageSvg(file: FileRow) {
  const lines = Array.from(
    { length: 13 },
    (_, i) =>
      `<rect x="44" y="${74 + i * 12}" width="${232 - ((file.id * (i + 1)) % 80)}" height="4" fill="#c4c7cc"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" preserveAspectRatio="xMidYMin slice"><rect width="320" height="240" fill="#23252a"/><rect x="24" y="14" width="272" height="360" fill="#f4f3ef"/><rect x="44" y="34" width="96" height="10" fill="#3c4048"/><rect x="216" y="34" width="60" height="22" fill="#d7dae0"/>${lines}</svg>`;
}

/** A data URL standing in for `/thumb/:id`. */
export function thumb(id: number, _size: number) {
  const file = files[id - 1]!;
  const svg =
    file.mime === 'application/pdf'
      ? pageSvg(file)
      : file.mime === 'image/png'
        ? shotSvg(file)
        : imageSvg(file);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const pdfPage = (text: string) =>
  `BT /F1 18 Tf 60 720 Td (${text}) Tj 0 -28 Td /F1 11 Tf (Fictional sample for the Jevonganize mock.) Tj ET`;
const pdfStream = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;

function pdfBytes(row: FileRow) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
  ];
  objects[3] = pdfStream(pdfPage(row.name.replace(/[()]/g, '')));
  objects[6] = pdfStream(pdfPage('Page 2'));
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  return `${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const urls = new Map<number, string>();

/** A blob URL standing in for `/file/:id`. */
export function fileUrl(id: number) {
  const known = urls.get(id);
  if (known) return known;
  const row = files[id - 1]!;
  const body =
    row.mime === 'application/pdf'
      ? pdfBytes(row)
      : row.mime === DOCX_MIME
        ? Uint8Array.from(atob(DOCX), (c) => c.charCodeAt(0))
        : `# ${row.name}\n\nFictional notes for the mock.\n\n- Tags: ${row.tags.join(', ')}\n- Next review: Thursday\n`;
  const url = URL.createObjectURL(new Blob([body], { type: row.mime ?? 'text/plain' }));
  urls.set(id, url);
  return url;
}

const sse = (chunks: unknown[]) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
};

const say = (id: string, text: string) => [
  { type: 'text-start', id },
  { type: 'text-delta', id, delta: text },
  { type: 'text-end', id },
];

const toolCall = (toolCallId: string, toolName: string, input: unknown) => [
  { type: 'tool-input-available', toolCallId, toolName, input, dynamic: true },
];

/** Stands in for `POST /api/chat`: finds files, proposes a plan, and asks to apply it. */
export const chatFetch: typeof fetch = async (_url, init) => {
  const { messages } = JSON.parse(init?.body as string) as {
    messages: { parts: { type: string; state?: string; approval?: { approved?: boolean } }[] }[];
  };
  const answered = messages.at(-1)?.parts.find((p) => p.approval?.approved !== undefined)
    ?.approval?.approved;
  if (answered !== undefined)
    return sse([
      { type: 'start' },
      { type: 'tool-approval-response', approvalId: 'approval-1', approved: answered },
      ...say(
        't2',
        answered
          ? 'Applied. Undo it from Activity, or with Mod+Z.'
          : 'Left as it was. Nothing was written.',
      ),
      { type: 'finish' },
    ]);
  const made = propose(
    {
      query: { tags: ['doc-type:invoice'] },
      add: ['topic:finance/tax'],
      title: 'Tag invoices for the tax folder',
    },
    'chat',
  );
  const found = search({ tags: ['doc-type:invoice'], limit: 5 });
  return sse([
    { type: 'start' },
    ...toolCall('c1', 'search_files', { tags: ['doc-type:invoice'] }),
    { type: 'tool-output-available', toolCallId: 'c1', output: found, dynamic: true },
    ...toolCall('c2', 'propose_changes', {
      query: { tags: ['doc-type:invoice'] },
      add: ['topic:finance/tax'],
    }),
    { type: 'tool-output-available', toolCallId: 'c2', output: made, dynamic: true },
    ...say('t1', `I found ${found.total} invoices and made a plan. Nothing has changed yet.`),
    ...toolCall('c3', 'apply_plan', { id: made.id }),
    { type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'c3' },
    { type: 'finish' },
  ]);
};
