/**
 * Generated virtual folders: one per tag namespace, with a child per value, nested by `/`, and a
 * month under its year. They are computed from the tag counts on every call and never stored.
 * See docs/concepts.md#virtual-folders.
 */
import type { FileQuery, Tag, VirtualFolderNode } from '../types.ts';
import type { Db } from './db.ts';

const YEAR_TAG = /^[^:]*:\d{4}$/;
/** A `namespace:YYYY-MM` tag, capturing `namespace:YYYY`. */
const MONTH_TAG = /^([^:]*:\d{4})-\d{2}$/;

/** The `FileQuery` of a generated folder, by its key: a tag, or `<namespace>:`. */
export const generatedQuery = (key: string): FileQuery => ({ tags: [key] });

/**
 * One generated folder per namespace, with a child per value, nested by `/`. A leaf's count is its
 * tag's; only a folder with children pays for a count of its own.
 */
export function generatedTree(db: Db): VirtualFolderNode[] {
  const toNodes = (level: Map<string, Draft>): VirtualFolderNode[] =>
    [...level.values()]
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((draft) => ({
        key: draft.key,
        name: draft.name,
        folder: null,
        count: needsOwnCount(draft) ? db.countFiles(generatedQuery(draft.key)) : draft.count!,
        children: toNodes(draft.children),
      }));
  return toNodes(draftTree(db));
}

/** A generated folder while the tree is built. `count` is its own tag's, if it is a tag. */
type Draft = { key: string; name: string; count: number | null; children: Map<string, Draft> };

/** One level of the generated tree on the way down to a tag. */
type Step = { key: string; name: string };

/** Every tag's place in the generated tree, as drafts keyed by folder key. */
function draftTree(db: Db): Map<string, Draft> {
  const roots = new Map<string, Draft>();
  for (const { tag, count } of db.tagCounts()) {
    let level = roots;
    let leaf: Draft | undefined;
    for (const step of generatedPath(tag)) {
      let node = level.get(step.key);
      if (!node) {
        node = { ...step, count: null, children: new Map() };
        level.set(step.key, node);
      }
      level = node.children;
      leaf = node;
    }
    if (leaf) leaf.count = count;
  }
  return roots;
}

/**
 * A parent, a year (which also holds its months) or a bare namespace holds more than one tag, so
 * its count is a query of its own rather than a tag's count.
 */
const needsOwnCount = (draft: Draft) =>
  draft.children.size > 0 || YEAR_TAG.test(draft.key) || draft.count === null;

/** Where a tag sits in the generated tree: the keys of its ancestors, then its own. */
function generatedPath(tag: Tag): Step[] {
  const colon = tag.indexOf(':');
  const hasNamespace = colon > 0;
  const namespace = hasNamespace ? tag.slice(0, colon + 1) : '';
  const value = hasNamespace ? tag.slice(colon + 1) : tag;
  const steps: Step[] = hasNamespace ? [{ key: namespace, name: namespace.slice(0, -1) }] : [];
  const parts = value.split('/');
  parts.forEach((part, depth) => {
    const key = namespace + parts.slice(0, depth + 1).join('/');
    steps.push({ key, name: part });
  });
  // A month belongs to its year, as it does in a tag filter.
  const month = MONTH_TAG.exec(tag);
  if (month) {
    const yearTag = month[1]!;
    const year = { key: yearTag, name: yearTag.slice(colon + 1) };
    steps.splice(-1, 1, year, { key: tag, name: tag.slice(colon + 1) });
  }
  return steps;
}
