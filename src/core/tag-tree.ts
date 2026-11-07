/**
 * The tag tree, derived from tag names: a facet is a root, and each `/` part of a label is a level
 * under it. Plain tags make trees by `/` too. No table stores a parent, so the tree is built here on
 * each call, in memory. See docs/tags.md#hierarchy.
 */
import type { Facet, Tag, TagNode } from '../types.ts';
import type { Db } from './db.ts';
import { countTotals, filesPerTag, parseFileTagIds } from './tag-counts.ts';
import { facetsById, isMovable, placeOf, prefixOf, type TagPlace } from './tag-place.ts';

/** The fields of a node that its name decides. */
type NodeName = Pick<TagNode, 'path' | 'facet' | 'label' | 'depth' | 'movable'>;

/** A node with no files counted yet. */
const emptyNode = (name: NodeName): TagNode => ({
  ...name,
  direct: 0,
  total: 0,
  implicit: true,
  children: [],
});

const byPath = (left: TagNode, right: TagNode) =>
  left.path < right.path ? -1 : Number(left.path > right.path);

/** A tree being built: facet roots by facet id, other nodes by path, and the top-level leaves. */
interface TreeDraft {
  roots: Map<string, TagNode>;
  nodes: Map<string, TagNode>;
  flags: TagNode[];
  plain: TagNode[];
}

/** The root of a facet, made on first use. */
function rootOf(draft: TreeDraft, facet: Facet): TagNode {
  const existing = draft.roots.get(facet.id);
  if (existing) return existing;
  const name = { path: `${facet.id}:`, facet: facet.id, label: facet.id, depth: 0, movable: false };
  const root = emptyNode(name);
  draft.roots.set(facet.id, root);
  return root;
}

/** Adds a labelled tag and each implicit level above it. Returns them, from the root down. */
function addLabelled(draft: TreeDraft, place: TagPlace & { label: string }): TagNode[] {
  const levels = place.label.split('/');
  const facet = place.facet?.id ?? null;
  const movable = isMovable(place);
  const root = place.facet ? rootOf(draft, place.facet) : undefined;
  const ancestry = root ? [root] : [];
  let siblings = root ? root.children : draft.plain;
  for (let depth = 1; depth <= levels.length; depth++) {
    const path = prefixOf(place) + levels.slice(0, depth).join('/');
    let node = draft.nodes.get(path);
    if (!node) {
      node = emptyNode({ path, facet, label: levels[depth - 1]!, depth, movable });
      draft.nodes.set(path, node);
      siblings.push(node);
    }
    ancestry.push(node);
    siblings = node.children;
  }
  return ancestry;
}

/** A `flag:` tag: a leaf at the top level, which never moves. */
function addFlag(draft: TreeDraft, tag: Tag, facet: Facet): TagNode[] {
  const node = emptyNode({ path: tag, facet: facet.id, label: tag, depth: 1, movable: false });
  draft.flags.push(node);
  return [node];
}

/** Places a tag carried by `direct` files. Returns its node and every node above it. */
function addTag(draft: TreeDraft, tag: Tag, direct: number, facets: Map<string, Facet>) {
  const place = placeOf(tag, facets);
  const ancestry =
    place.label === null
      ? addFlag(draft, tag, place.facet!)
      : addLabelled(draft, { ...place, label: place.label });
  const node = ancestry.at(-1)!;
  node.direct = direct;
  node.implicit = direct === 0;
  return ancestry;
}

/** Sorts each level by path, so the order is the same on every call. */
function sortTree(nodes: TagNode[]): TagNode[] {
  for (const node of nodes) node.children = sortTree(node.children);
  return nodes.toSorted(byPath);
}

/** What `list_tag_tree` can narrow to. */
export interface TagTreeFilter {
  facet?: string;
  folder?: string;
}

/**
 * The tag tree, with each node's files counted. One read of every file's tags counts them all,
 * which beats a distinct count per parent many times over on a large index. See docs/contracts.md.
 */
export function listTagTree(db: Db, facets: Facet[], filter: TagTreeFilter = {}): TagNode[] {
  const known = facetsById(facets);
  const files = parseFileTagIds(db.tagIdsByFile(filter.folder));
  const names = db.tagNames();
  const draft: TreeDraft = { roots: new Map(), nodes: new Map(), flags: [], plain: [] };
  const ancestries = new Map<number, TagNode[]>();
  for (const [id, direct] of filesPerTag(files)) {
    const tag = names.get(id)!;
    const isInFacet = filter.facet === undefined || placeOf(tag, known).facet?.id === filter.facet;
    if (isInFacet) ancestries.set(id, addTag(draft, tag, direct, known));
  }
  countTotals(files, ancestries);
  const roots = sortTree([...draft.roots.values()]);
  return [...roots, ...draft.flags.toSorted(byPath), ...sortTree(draft.plain)];
}
