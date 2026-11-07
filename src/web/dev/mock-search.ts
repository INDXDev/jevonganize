/** Queries over the mock's files. */
import type { FileDetail, FileQuery, FileRow, SimilarFile } from '../../types.ts';
import { files } from './mock-files.ts';

/** The facet part of a tag, if it has one. */
export const facetOf = (tag: string) => (tag.includes(':') ? tag.split(':')[0]! : null);

function mimeMatches(file: FileRow, wanted: string) {
  return wanted.endsWith('*') ? file.mime?.startsWith(wanted.slice(0, -1)) : file.mime === wanted;
}

/** True when a file passes a query's folder, text, tag, type and status filters. */
export function matches(file: FileRow, q: FileQuery) {
  const tagged = (tag: string) =>
    file.tags.some((t) =>
      tag.endsWith(':') ? t.startsWith(tag) : t === tag || t.startsWith(`${tag}/`),
    );
  const group = (tags: string[], match?: 'any' | 'all') =>
    match === 'any' ? tags.some(tagged) : tags.every(tagged);
  const searchable = `${file.name} ${file.tags.join(' ')}`.toLowerCase();
  if (q.folder && !file.path.startsWith(q.folder)) return false;
  if (q.text && !searchable.includes(q.text.toLowerCase())) return false;
  if (q.tags && !(q.tag_match === 'any' ? q.tags.some(tagged) : q.tags.every(tagged))) return false;
  if (q.exclude_tags?.some(tagged)) return false;
  if (q.tag_groups?.some((g) => !group(g.tags, g.tag_match))) return false;
  if (q.mime && !mimeMatches(file, q.mime)) return false;
  return !q.status || file.status === q.status;
}

/** How many files `organize` or `estimate` would take for a query. */
export const matchCount = (query: FileQuery) =>
  Math.min(query.limit ?? Infinity, files.filter((f) => matches(f, query)).length);

/** Stands in for `search_files`. */
export function search(q: FileQuery) {
  const sign = q.order === 'asc' ? 1 : -1;
  const sorted = files
    .filter((f) => matches(f, q))
    .filter((f) => !q.hide_dotfiles || !f.path.includes('/.'))
    .filter((f) => !q.direct_only || f.path === `${q.folder}/${f.name}`)
    .toSorted((a, b) => {
      if (q.sort === 'name') return sign * a.name.localeCompare(b.name);
      if (q.sort === 'size') return sign * (a.size - b.size);
      return sign * (a.mtime_ms - b.mtime_ms);
    });
  const offset = q.offset ?? 0;
  return { files: sorted.slice(offset, offset + (q.limit ?? 50)), total: sorted.length };
}

/** How many files carry each tag. */
export const df = () => {
  const counts = new Map<string, number>();
  for (const f of files) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
};

/** Stands in for `similar_files`. */
export function similar(id: number, limit = 12): SimilarFile[] {
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

/** The metadata of a file. Everything here is made up. */
function metadataOf(file: FileRow, id: number): FileDetail['metadata'] {
  return file.mime?.startsWith('image/')
    ? { width: 4032, height: 3024, camera: 'Fictional F2', iso: 200 }
    : { author: 'Mika Tanaka', pages: 1 + (id % 9), title: file.name.split('.')[0]! };
}

/** The answers that would have made a file's tags. */
function answersOf(file: FileRow): FileDetail['answers'] {
  return file.tags
    .filter((t) => t.includes(':'))
    .map((t, i) => ({
      facet: facetOf(t)!,
      value: t.split(':')[1]!,
      confidence: i === 2 ? null : 0.98 - i * 0.03,
      estimated: i === 1,
      refused: false,
    }));
}

/** Stands in for `get_file`, given the open review items. */
export function detail(id: number, reviews: FileDetail['reviews']): FileDetail {
  const file = files[id - 1];
  if (!file) throw new Error(`No file ${id}`);
  return {
    ...file,
    metadata: metadataOf(file, id),
    answers: answersOf(file),
    reviews: reviews.filter((r) => r.file_id === id),
    taggable: !file.path.includes('/Downloads/'),
  };
}
