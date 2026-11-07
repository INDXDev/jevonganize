/** The mock's folder suggestions: the shapes of `core/vfolder-suggest.ts`, with simpler ranking. */
import type { ToolMap } from '../../tool-map.ts';
import { files } from './mock-files.ts';
import { listTags } from './mock-library.ts';
import { facetOf, fileMatchesQuery } from './mock-search.ts';

/** A tag's value as a person reads it: `topic:finance/tax` is `finance / tax`. */
const readable = (tag: string) =>
  (tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag).split('/').join(' / ');

/** Stands in for `suggest_vfolder_tags`: tags on some of the rule's files, else the common ones. */
export function suggestVfolderTags(
  input: ToolMap['suggest_vfolder_tags'][0],
): ToolMap['suggest_vfolder_tags'][1] {
  const inRule = files.filter((file) => fileMatchesQuery(file, input));
  const total = new Map(listTags({}).map(({ tag, count }) => [tag, count]));
  const withRule = new Map<string, number>();
  for (const file of inRule)
    for (const tag of file.tags) withRule.set(tag, (withRule.get(tag) ?? 0) + 1);
  const blocked = new Set([...input.tags, ...(input.exclude_tags ?? [])]);
  const narrowing = input.tags.length > 0;
  const suggestions = [...withRule]
    .filter(([tag, n]) => !blocked.has(tag) && (!narrowing || (n >= 2 && n < inRule.length)))
    .toSorted(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .slice(0, input.limit ?? 12)
    .map(([tag, n]) => ({
      tag,
      facet: facetOf(tag),
      count: total.get(tag) ?? 0,
      with_rule: n,
      reason: narrowing ? ('narrows' as const) : ('common' as const),
    }));
  return { matches: inRule.length, suggestions };
}

/** Stands in for `suggest_vfolders`: the largest tags, each as a folder of its own. */
export function suggestVfolders({ limit = 8 }: ToolMap['suggest_vfolders'][0]) {
  return listTags({})
    .filter(({ count }) => count >= 2)
    .slice(0, limit)
    .map(({ tag, count }) => ({
      name: readable(tag),
      rule: { tags: [tag], tag_match: 'all' as const, exclude_tags: [] },
      count,
      reason: 'large-tag' as const,
    }));
}
