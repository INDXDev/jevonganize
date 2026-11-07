/**
 * Writes presets/catalog.txt: tens of thousands of subjects, one `<domain>/<concept>` per line.
 * Run: OPENAI_API_KEY=... node scripts/catalog.ts <cache dir>
 *
 * Names come from Wikipedia's Vital Articles (level 4, without people), IPTC Media Topics and
 * OpenAlex. A chat model files each under a domain, drops what cannot tag a document, and adds
 * everyday subjects, which those sources thin out on. Only public names are sent. Every step caches, so a rerun is free.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERATED_ROUNDS = 3;
const MAX_LABEL = 57; // A tag is at most 64 characters, and `topic:` takes 6.
const CHAT_MODEL = 'gpt-5.4-mini';
const BATCH = 50;
const PARALLEL = 16;
const AGENT = { 'User-Agent': 'jevonganize-catalog-build/0.1' };

/** The first 14 are values of the `topic` preset, so `topic:finance` also finds its children. */
const DOMAINS = [
  'finance',
  'legal',
  'health',
  'insurance',
  'housing',
  'work',
  'education',
  'travel',
  'family',
  'technology',
  'government',
  'shopping',
  'vehicles',
  'hobbies',
  'business',
  'science',
  'mathematics',
  'engineering',
  'nature',
  'environment',
  'agriculture',
  'food',
  'sports',
  'arts',
  'music',
  'film-and-media',
  'literature',
  'language',
  'history',
  'geography',
  'philosophy',
  'religion',
  'politics',
  'society',
];
const VITAL_PAGES = [
  'Arts',
  'Biology and health sciences',
  'Everyday life',
  'Geography',
  'History',
  'Mathematics',
  'Philosophy and religion',
  'Physical sciences',
  'Society and social sciences',
  'Technology',
];

const cacheDir = process.argv[2] ?? '';
if (!cacheDir) throw new Error('Usage: node scripts/catalog.ts <cache dir>');
mkdirSync(cacheDir, { recursive: true });

async function cached<T>(name: string, make: () => Promise<T>): Promise<T> {
  const file = join(cacheDir, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const value = await make();
  writeFileSync(file, JSON.stringify(value));
  return value;
}

const sleep = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000));

/** Waits as long as a rate limit asks, so the public services are not hammered. */
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { headers: AGENT });
    if (response.ok) return response.json();
    if (response.status !== 429) throw new Error(`${url}: ${response.status}`);
    await sleep(Number(response.headers.get('retry-after')) || 15 * (attempt + 1));
  }
  throw new Error(`${url}: still rate limited`);
}

async function vitalNames(): Promise<string[]> {
  const names: string[] = [];
  for (const page of VITAL_PAGES) {
    const title = encodeURIComponent(`Wikipedia:Vital articles/Level 4/${page}`);
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${title}&prop=wikitext&format=json`;
    const text: string = (await getJson(url)).parse.wikitext['*'];
    await sleep(3);
    for (const [, name] of text.matchAll(/^#.*?\[\[([^\]|#:]+)/gm)) names.push(name as string);
  }
  return names;
}

async function iptcNames(): Promise<string[]> {
  const { conceptSet } = await getJson(
    'https://cv.iptc.org/newscodes/mediatopic/?lang=en-GB&format=json',
  );
  return conceptSet.flatMap((concept: any) => {
    const retired = concept.retired || concept.replacedBy;
    return !retired && concept.prefLabel?.['en-GB'] ? [concept.prefLabel['en-GB']] : [];
  });
}

async function openAlexNames(): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; page <= 23; page++) {
    const url = `https://api.openalex.org/topics?per-page=200&page=${page}&select=keywords,subfield,field`;
    for (const topic of (await getJson(url)).results) {
      names.push(topic.subfield.display_name, topic.field.display_name);
      for (const keyword of topic.keywords) names.push(keyword.display_name ?? keyword);
    }
  }
  return names;
}

/** `Mercury (planet)` to `mercury`. Empty when nothing usable is left. */
function conceptSlug(name: string): string {
  return name
    .replace(/\(.*?\)/g, ' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const sameWord = (slug: string) => slug.replace(/(?<=[a-z]{3})s(?=-|$)/g, '');

async function chat<T>(system: string, user: string, schema: object): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'result', strict: true, schema },
        },
      }),
    });
    if (response.ok) {
      const body: any = await response.json();
      return JSON.parse(body.choices[0].message.content) as T;
    }
    if (attempt === 4) throw new Error(`${response.status}: ${await response.text()}`);
    await sleep(2 * (attempt + 1));
  }
}

async function inParallel<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return results;
}

const CLASSIFY = `You file subject names under domains, for a tool that tags personal and work documents.
Domains: ${DOMAINS.join(', ')}.
Names are numbered. For every number, give the domain a document on that subject belongs to.
Give "drop" for a named person, a single work of art, a term so vague it would describe any document, or an obscure research term almost nobody has files about.`;

/** Each name's domain, or `drop`. */
async function classify(names: string[]): Promise<Map<string, string>> {
  const batches: string[][] = [];
  for (let start = 0; start < names.length; start += BATCH) {
    batches.push(names.slice(start, start + BATCH));
  }
  const item = {
    type: 'object',
    additionalProperties: false,
    required: ['number', 'domain'],
    properties: {
      number: { type: 'integer' },
      domain: { type: 'string', enum: [...DOMAINS, 'drop'] },
    },
  };
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: { items: { type: 'array', items: item } },
  };
  const answers = await inParallel(batches, async (batch) => {
    const list = batch.map((name, index) => `${index + 1}. ${name}`).join('\n');
    const { items } = await chat<{ items: { number: number; domain: string }[] }>(
      CLASSIFY,
      list,
      schema,
    );
    // Matched by number, because a model that skips one line would shift a bare list.
    const domains = new Map(items.map(({ number, domain }) => [number, domain]));
    return batch.map((name, index) => [name, domains.get(index + 1) ?? 'drop'] as const);
  });
  return new Map(answers.flat());
}

const GENERATE = (domain: string, round: number) =>
  `List 120 distinct subjects within the domain "${domain}" that ordinary people or workers keep files about: their documents, notes, spreadsheets, photos or downloads.
Each is a common English noun phrase of one to three words, general rather than a brand or a person. Prefer concrete, practical subjects. This is round ${round}, so reach past the obvious.`;

async function generate(domain: string, round: number): Promise<string[]> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['subjects'],
    properties: { subjects: { type: 'array', items: { type: 'string' } } },
  };
  const { subjects } = await chat<{ subjects: string[] }>(
    'You help build a subject catalog.',
    GENERATE(domain, round),
    schema,
  );
  return subjects;
}

const sources = [
  ...(await cached('vital', vitalNames)),
  ...(await cached('iptc', iptcNames)),
  ...(await cached('openalex', openAlexNames)),
];
const names = [...new Map(sources.map((name) => [sameWord(conceptSlug(name)), name])).values()];
console.error(`${sources.length} names, ${names.length} after merging`);
const filed = new Map(await cached('classified-all', async () => [...(await classify(names))]));

const catalog = new Map<string, string>();
const add = (name: string, domain: string) => {
  const concept = conceptSlug(name);
  const label = `${domain}/${concept}`;
  if (concept && label.length <= MAX_LABEL && !catalog.has(sameWord(concept))) {
    catalog.set(sameWord(concept), label);
  }
};
for (const [name, domain] of filed) if (domain !== 'drop') add(name, domain);
console.error(`${catalog.size} from public sources`);

for (let round = 1; round <= GENERATED_ROUNDS; round++) {
  const lists = await cached(`generated-${round}`, () =>
    inParallel(DOMAINS, async (domain) => [domain, await generate(domain, round)] as const),
  );
  for (const [domain, subjects] of lists) for (const name of subjects) add(name, domain);
  console.error(`round ${round}: ${catalog.size}`);
}

writeFileSync('presets/catalog.txt', `${[...catalog.values()].toSorted().join('\n')}\n`);
