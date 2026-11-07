/** The tag hierarchy as a tree: facets at the root, `/` levels below, with drag and drop to move. */
import { t } from '../i18n/index.ts';
import { useState } from 'react';
import type { TagNode } from '../../types.ts';
import { formatCount } from '../lib.ts';
import { useTreeDrag, type MoveTag } from './tags-drag.ts';
import { TreeRow, type Row } from './tags-list-row.tsx';

/** How many rows the tree renders at most. Filtering or collapsing narrows the rest. */
const ROWS_SHOWN = 500;

/** True when the node's path contains `needle`, or the path of a node under it does. */
function containsMatch(node: TagNode, needle: string): boolean {
  if (node.path.toLowerCase().includes(needle)) return true;
  return node.children.some((child) => containsMatch(child, needle));
}

/** The rows to show, depth first. A filter opens every level that holds a match. */
function visibleRows(nodes: TagNode[], collapsed: Set<string>, needle: string): Row[] {
  const rows: Row[] = [];
  const addLevel = (level: TagNode[], depth: number) => {
    for (const node of level) {
      if (needle && !containsMatch(node, needle)) continue;
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && (!!needle || !collapsed.has(node.path));
      rows.push({ node, level: depth, expanded });
      if (expanded) addLevel(node.children, depth + 1);
    }
  };
  addLevel(nodes, 0);
  return rows;
}

/** Every tag a file carries in the tree, which is every node that is not implicit. */
export function countTags(nodes: TagNode[]): number {
  let count = 0;
  for (const node of nodes) count += Number(!node.implicit) + countTags(node.children);
  return count;
}

/** The tree, with each level open until closed. Dropping a row on another plans a move. */
export function TagTree(props: {
  nodes: TagNode[];
  filterText: string;
  selected?: string;
  onMove: MoveTag;
}) {
  const { nodes, filterText, selected, onMove } = props;
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const drag = useTreeDrag(onMove);
  const needle = filterText.trim().toLowerCase();
  const rows = visibleRows(nodes, collapsed, needle);
  const toggleCollapsed = (path: string) => {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  };
  return (
    <>
      <ul role="tree" aria-label={t('Tags')} className="py-1" onDragEnd={drag.reset}>
        {rows.slice(0, ROWS_SHOWN).map((row) => (
          <TreeRow
            key={row.node.path}
            row={row}
            selected={row.node.path === selected}
            dropSpot={drag.dropSpot?.path === row.node.path ? drag.dropSpot : undefined}
            onToggle={() => toggleCollapsed(row.node.path)}
            onDragStart={() => drag.beginDrag(row.node)}
            onDragOver={drag.handleDragOver(row.node)}
            onDrop={() => drag.handleDrop(row.node)}
          />
        ))}
      </ul>
      {rows.length > ROWS_SHOWN && (
        <p className="px-3 pb-2 text-xs text-subtle">
          {t('First {shown} of {total}. Filter to narrow them.', {
            shown: ROWS_SHOWN,
            total: formatCount(rows.length),
          })}
        </p>
      )}
    </>
  );
}
