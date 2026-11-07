/** Subject names from public sources, for scripts/catalog.ts. Only public names are fetched. */

const AGENT = { 'User-Agent': 'jevonganize-catalog-build/0.1' };

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

/** Waits this many seconds. */
export const sleep = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000));

const FETCH_ATTEMPTS = 6;

/** Waits as long as a rate limit asks, so the public services are not hammered. */
async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const response = await fetch(url, { headers: AGENT });
    if (response.ok) return (await response.json()) as T;
    if (response.status !== 429) throw new Error(`${url}: ${response.status}`);
    const retryAfterSeconds = Number(response.headers.get('retry-after')) || 15 * (attempt + 1);
    await sleep(retryAfterSeconds);
  }
  throw new Error(`${url}: still rate limited`);
}

interface WikiParse {
  parse: { wikitext: { '*': string } };
}

/** A numbered line's first link, which is the article the line lists. */
const VITAL_ARTICLE = /^#.*?\[\[([^\]|#:]+)/gm;

/** Article titles from Wikipedia's Vital Articles, level 4. */
export async function vitalNames(): Promise<string[]> {
  const names: string[] = [];
  for (const page of VITAL_PAGES) {
    const title = encodeURIComponent(`Wikipedia:Vital articles/Level 4/${page}`);
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${title}&prop=wikitext&format=json`;
    const wikitext = (await getJson<WikiParse>(url)).parse.wikitext['*'];
    await sleep(3);
    for (const [, name] of wikitext.matchAll(VITAL_ARTICLE)) names.push(name as string);
  }
  return names;
}

interface IptcConcept {
  retired?: unknown;
  replacedBy?: unknown;
  prefLabel?: Record<string, string>;
}

/** IPTC Media Topics that are still in use. */
export async function iptcNames(): Promise<string[]> {
  const url = 'https://cv.iptc.org/newscodes/mediatopic/?lang=en-GB&format=json';
  const { conceptSet } = await getJson<{ conceptSet: IptcConcept[] }>(url);
  return conceptSet.flatMap((concept) => {
    const isRetired = concept.retired || concept.replacedBy;
    const label = concept.prefLabel?.['en-GB'];
    return !isRetired && label ? [label] : [];
  });
}

interface OpenAlexTopic {
  subfield: { display_name: string };
  field: { display_name: string };
  keywords: ({ display_name?: string } | string)[];
}

const OPENALEX_PAGES = 23;

/** OpenAlex fields, subfields and topic keywords. */
export async function openAlexNames(): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; page <= OPENALEX_PAGES; page++) {
    const url = `https://api.openalex.org/topics?per-page=200&page=${page}&select=keywords,subfield,field`;
    const { results } = await getJson<{ results: OpenAlexTopic[] }>(url);
    for (const topic of results) {
      names.push(topic.subfield.display_name, topic.field.display_name);
      // A keyword may be an object holding its name, or the bare name.
      for (const keyword of topic.keywords) {
        names.push(typeof keyword === 'string' ? keyword : (keyword.display_name ?? ''));
      }
    }
  }
  return names;
}
