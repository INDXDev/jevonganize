/** Queries over the mock's files. */
import type { FileDetail, FileQuery, FileRow, SimilarFile } from '../../types.ts';
import { files } from './mock-files.ts';

/** The facet part of a tag, if it has one. */
export const facetOf = (tag: string) => (tag.includes(':') ? tag.split(':')[0]! : null);

/** `image/*` matches every image type; anything else must match exactly. */
function mimeMatches(file: FileRow, wanted: string) {
  return wanted.endsWith('*') ? file.mime?.startsWith(wanted.slice(0, -1)) : file.mime === wanted;
}

/**
 * Whether a file carries `wanted`. A bare facet such as `topic:` matches any of its values, and
 * a tag matches its own children, so `topic:finance` matches `topic:finance/tax`.
 */
function hasTag(file: FileRow, wanted: string) {
  return file.tags.some((tag) =>
    wanted.endsWith(':') ? tag.startsWith(wanted) : tag === wanted || tag.startsWith(`${wanted}/`),
  );
}

function matchesTags(file: FileRow, tags: string[], match?: 'any' | 'all') {
  const carries = (tag: string) => hasTag(file, tag);
  return match === 'any' ? tags.some(carries) : tags.every(carries);
}

/** True when a file passes a query's folder, text, tag, type and status filters. */
export function fileMatchesQuery(file: FileRow, query: FileQuery) {
  const searchable = `${file.name} ${file.tags.join(' ')}`.toLowerCase();
  if (query.folder && !file.path.startsWith(query.folder)) return false;
  if (query.text && !searchable.includes(query.text.toLowerCase())) return false;
  if (query.tags && !matchesTags(file, query.tags, query.tag_match)) return false;
  if (query.exclude_tags?.some((tag) => hasTag(file, tag))) return false;
  if (query.tag_groups?.some((group) => !matchesTags(file, group.tags, group.tag_match)))
    return false;
  if (query.mime && !mimeMatches(file, query.mime)) return false;
  return !query.status || file.status === query.status;
}

/** How many files `organize` or `estimate` would take for a query. */
export const countMatchingFiles = (query: FileQuery) =>
  Math.min(query.limit ?? Infinity, files.filter((file) => fileMatchesQuery(file, query)).length);

function compareFiles(a: FileRow, b: FileRow, sort: FileQuery['sort']) {
  if (sort === 'name') return a.name.localeCompare(b.name);
  if (sort === 'size') return a.size - b.size;
  return a.mtime_ms - b.mtime_ms;
}

/** Stands in for `search_files`. Any sort but name and size orders by date. */
export function searchFiles(query: FileQuery) {
  const direction = query.order === 'asc' ? 1 : -1;
  const sorted = files
    .filter((file) => fileMatchesQuery(file, query))
    .filter((file) => !query.hide_dotfiles || !file.path.includes('/.'))
    .filter((file) => !query.direct_only || file.path === `${query.folder}/${file.name}`)
    .toSorted((a, b) => direction * compareFiles(a, b, query.sort));
  const offset = query.offset ?? 0;
  return { files: sorted.slice(offset, offset + (query.limit ?? 50)), total: sorted.length };
}

/** How many files carry each tag. */
export const countFilesPerTag = () => {
  const counts = new Map<string, number>();
  for (const file of files)
    for (const tag of file.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return counts;
};

/** Stands in for `similar_files`: shared tags weighted by rarity, over all tags of the pair. */
export function similarFiles(id: number, limit = 12): SimilarFile[] {
  const counts = countFilesPerTag();
  const rarity = (tag: string) => Math.log(1 + files.length / (counts.get(tag) ?? 1));
  const weight = (tags: Iterable<string>) => [...tags].reduce((sum, tag) => sum + rarity(tag), 0);
  const source = files[id - 1]!;
  const sourceTags = new Set(source.tags);
  return files
    .filter((file) => file.id !== id)
    .map((file) => {
      const shared = file.tags.filter((tag) => sourceTags.has(tag));
      const allTags = new Set([...file.tags, ...source.tags]);
      return { ...file, shared, score: allTags.size ? weight(shared) / weight(allTags) : 0 };
    })
    .filter((file) => file.shared.length)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The metadata of a file. Everything here is made up. */
function metadataOf(file: FileRow, id: number): FileDetail['metadata'] {
  return file.mime?.startsWith('image/')
    ? { width: 4032, height: 3024, camera: 'Fictional F2', iso: 200 }
    : { author: 'Mika Tanaka', pages: 1 + (id % 9), title: file.name.split('.')[0]! };
}

/** The answers that would have made a file's tags. The second is estimated, the third has no confidence. */
function answersOf(file: FileRow): FileDetail['answers'] {
  return file.tags
    .filter((tag) => tag.includes(':'))
    .map((tag, i) => ({
      facet: facetOf(tag)!,
      value: tag.split(':')[1]!,
      confidence: i === 2 ? null : 0.98 - i * 0.03,
      estimated: i === 1,
      refused: false,
    }));
}

/** Stands in for `get_file`, given the open review items. */
export function fileDetail(id: number, reviews: FileDetail['reviews']): FileDetail {
  const file = files[id - 1];
  if (!file) throw new Error(`No file ${id}`);
  return {
    ...file,
    metadata: metadataOf(file, id),
    answers: answersOf(file),
    reviews: reviews.filter((review) => review.file_id === id),
    taggable: !file.path.includes('/Downloads/'),
  };
}
