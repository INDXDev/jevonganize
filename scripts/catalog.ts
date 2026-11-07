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
import { classify, DOMAINS, generate, inParallel } from './catalog-model.ts';
import { iptcNames, openAlexNames, vitalNames } from './catalog-sources.ts';

const GENERATED_ROUNDS = 3;
const MAX_LABEL = 57; // A tag is at most 64 characters, and `topic:` takes 6.

const cacheDir = process.argv[2] ?? '';
if (!cacheDir) throw new Error('Usage: node scripts/catalog.ts <cache dir>');
mkdirSync(cacheDir, { recursive: true });

/** `make`'s result, kept in the cache directory as `<name>.json` so a rerun is free. */
async function cached<T>(name: string, make: () => Promise<T>): Promise<T> {
  const file = join(cacheDir, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const value = await make();
  writeFileSync(file, JSON.stringify(value));
  return value;
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

/** A slug with plural `s` endings dropped, so `tax` and `taxes` count as one subject. */
const singularKey = (slug: string) => slug.replace(/(?<=[a-z]{3})s(?=-|$)/g, '');

/** Every public name, one per subject once plurals and brackets are set aside. */
async function publicNames(): Promise<string[]> {
  const sources = [
    ...(await cached('vital', vitalNames)),
    ...(await cached('iptc', iptcNames)),
    ...(await cached('openalex', openAlexNames)),
  ];
  const bySubject = new Map(sources.map((name) => [singularKey(conceptSlug(name)), name]));
  const names = [...bySubject.values()];
  console.error(`${sources.length} names, ${names.length} after merging`);
  return names;
}

/** Labels by subject. The first domain a subject is filed under keeps it. */
const catalog = new Map<string, string>();

function addToCatalog(name: string, domain: string): void {
  const concept = conceptSlug(name);
  const label = `${domain}/${concept}`;
  const key = singularKey(concept);
  const fits = concept !== '' && label.length <= MAX_LABEL;
  if (fits && !catalog.has(key)) catalog.set(key, label);
}

/** Files every public name under its domain, leaving out what the model dropped. */
async function addPublicNames(): Promise<void> {
  const names = await publicNames();
  const filed = new Map(await cached('classified-all', async () => [...(await classify(names))]));
  for (const [name, domain] of filed) if (domain !== 'drop') addToCatalog(name, domain);
  console.error(`${catalog.size} from public sources`);
}

/** Adds the everyday subjects the model lists for each domain, one round at a time. */
async function addGeneratedSubjects(): Promise<void> {
  for (let round = 1; round <= GENERATED_ROUNDS; round++) {
    const listsByDomain = await cached(`generated-${round}`, () =>
      inParallel(DOMAINS, async (domain) => [domain, await generate(domain, round)] as const),
    );
    for (const [domain, subjects] of listsByDomain) {
      for (const name of subjects) addToCatalog(name, domain);
    }
    console.error(`round ${round}: ${catalog.size}`);
  }
}

await addPublicNames();
await addGeneratedSubjects();
const lines = [...catalog.values()].toSorted();
writeFileSync('presets/catalog.txt', `${lines.join('\n')}\n`);
