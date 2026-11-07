/** The chat model's part of scripts/catalog.ts: filing names under domains, and listing more. */
import { sleep } from './catalog-sources.ts';

const CHAT_MODEL = 'gpt-5.4-mini';
const BATCH = 50;
const PARALLEL = 16;

/** The first 14 are values of the `topic` preset, so `topic:finance` also finds its children. */
export const DOMAINS = [
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

const CHAT_RETRIES = 4;

function chatRequest(system: string, user: string, schema: object): RequestInit {
  return {
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
  };
}

/** One chat call whose answer must match `schema`, retried with a growing pause. */
async function chatJson<T>(system: string, user: string, schema: object): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      chatRequest(system, user, schema),
    );
    if (response.ok) {
      const body: any = await response.json();
      return JSON.parse(body.choices[0].message.content) as T;
    }
    if (attempt === CHAT_RETRIES) throw new Error(`${response.status}: ${await response.text()}`);
    await sleep(2 * (attempt + 1));
  }
}

/** Runs `work` on every item, `PARALLEL` at a time, and keeps the results in order. */
export async function inParallel<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
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

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'domain'],
        properties: {
          number: { type: 'integer' },
          domain: { type: 'string', enum: [...DOMAINS, 'drop'] },
        },
      },
    },
  },
};

const chunked = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

/** One batch of names, each with its domain or `drop`. */
async function classifyBatch(batch: string[]): Promise<(readonly [string, string])[]> {
  const numberedList = batch.map((name, index) => `${index + 1}. ${name}`).join('\n');
  type Filed = { items: { number: number; domain: string }[] };
  const { items } = await chatJson<Filed>(CLASSIFY, numberedList, CLASSIFY_SCHEMA);
  // Matched by number, because a model that skips one line would shift a bare list.
  const domainByNumber = new Map(items.map(({ number, domain }) => [number, domain]));
  return batch.map((name, index) => [name, domainByNumber.get(index + 1) ?? 'drop'] as const);
}

/** Each name's domain, or `drop`. */
export async function classify(names: string[]): Promise<Map<string, string>> {
  const answers = await inParallel(chunked(names, BATCH), classifyBatch);
  return new Map(answers.flat());
}

const GENERATE = (domain: string, round: number) =>
  `List 120 distinct subjects within the domain "${domain}" that ordinary people or workers keep files about: their documents, notes, spreadsheets, photos or downloads.
Each is a common English noun phrase of one to three words, general rather than a brand or a person. Prefer concrete, practical subjects. This is round ${round}, so reach past the obvious.`;

const GENERATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subjects'],
  properties: { subjects: { type: 'array', items: { type: 'string' } } },
};

/** Everyday subjects in one domain. A later round is asked to reach further. */
export async function generate(domain: string, round: number): Promise<string[]> {
  const system = 'You help build a subject catalog.';
  const prompt = GENERATE(domain, round);
  const { subjects } = await chatJson<{ subjects: string[] }>(system, prompt, GENERATE_SCHEMA);
  return subjects;
}
