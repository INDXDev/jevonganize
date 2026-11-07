/** Dev-only stand-ins for the tag tree tools. All data is fictional. */
import type { ToolMap } from '../../tool-map.ts';
import type { TagNode } from '../../types.ts';
import { listTags } from './mock-library.ts';
import { propose } from './mock-plans.ts';

/** The one closed facet in the mock data, whose labels cannot move. */
const CLOSED_FACET = 'doc-type';

/** One level on the way down to a tag: the facet root at depth 0, then each `/` part. */
interface Level {
  path: string;
  label: string;
  depth: number;
}

/** The levels from a tag's root down to the tag: `topic:a/b` gives `topic:`, `topic:a`, `topic:a/b`. */
function levelsOf(tag: string, facet: string | null): Level[] {
  const prefix = facet ? `${facet}:` : '';
  const parts = tag.slice(prefix.length).split('/');
  const labelled = parts.map((label, index) => ({
    path: prefix + parts.slice(0, index + 1).join('/'),
    label,
    depth: index + 1,
  }));
  return facet ? [{ path: prefix, label: facet, depth: 0 }, ...labelled] : labelled;
}

/** The node for a level among `siblings`, added with nothing counted when it is new. */
function nodeFor(siblings: TagNode[], level: Level, facet: string | null): TagNode {
  const existing = siblings.find((sibling) => sibling.path === level.path);
  if (existing) return existing;
  const movable = level.depth > 0 && facet !== CLOSED_FACET;
  const created = { ...level, facet, direct: 0, total: 0, implicit: true, movable, children: [] };
  siblings.push(created);
  return created;
}

/** Counts a tag's files on its own node and on every level above it. */
function addTag(top: TagNode[], { tag, facet, count }: ReturnType<typeof listTags>[number]): void {
  let siblings = top;
  const levels = levelsOf(tag, facet);
  for (const level of levels) {
    const node = nodeFor(siblings, level, facet);
    node.total += count;
    const isTheTag = level.depth === levels.at(-1)!.depth;
    if (isTheTag) Object.assign(node, { direct: count, implicit: false });
    siblings = node.children;
  }
}

/** Stands in for `list_tag_tree`. Totals add up tag counts, which the real one deduplicates. */
export function listTagTree({ facet, folder }: ToolMap['list_tag_tree'][0]): TagNode[] {
  const top: TagNode[] = [];
  const rows = listTags({ folder }).filter((row) => !facet || row.facet === facet);
  for (const row of rows) addTag(top, row);
  return top;
}

/** Stands in for `move_tag`: a plan that swaps the tag for its new path. */
export function moveTag({ from, parent }: ToolMap['move_tag'][0]) {
  const prefixEnd = from.indexOf(':') + 1;
  const leaf = from.slice(prefixEnd).split('/').at(-1)!;
  const to = parent ? `${parent}/${leaf}` : from.slice(0, prefixEnd) + leaf;
  return propose({ query: { tags: [from] }, add: [to], remove: [from], title: `move ${from}` });
}
