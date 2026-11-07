import { t } from '../i18n/index.ts';
import { useState } from 'react';
import type { VirtualFolderNode } from '../../types.ts';
import { cn } from '../lib.ts';
import type { View } from '../view-query.ts';
import {
  ExpandToggle,
  FolderOpenButton,
  RowActions,
  useFolderDrop,
  type DropFiles,
  type Editing,
} from './folders-tree-row.tsx';

/** How many rows a level shows before the rest fold under "more". */
const ROWS_SHOWN = 8;

/** Indent per level of nesting, in rem. */
const INDENT_REM = 0.75;

/** A folder in a flattened tree, with how deep it is nested. Top-level folders have depth 0. */
export type NestedFolder = { node: VirtualFolderNode; depth: number };

/** Every folder in the tree, parents before their children. */
export function flattenTree(nodes: VirtualFolderNode[], depth = 0): NestedFolder[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenTree(node.children, depth + 1)]);
}

type TreeProps = {
  depth: number;
  view: View;
  /** Set for the saved tree, which can be edited. The generated tree is read-only. */
  onEdit?: (editing: Editing) => void;
  onDrop?: DropFiles;
};

/** One folder: its row, then its children while expanded. Saved folders start expanded. */
function FolderRow(props: TreeProps & { node: VirtualFolderNode }) {
  const { node, depth, view, onEdit, onDrop } = props;
  const [isExpanded, setIsExpanded] = useState(!!node.folder);
  const fileDrop = useFolderDrop(node.folder, onDrop);
  const isOpenInList = view.vfolder === node.key;
  const hasChildren = node.children.length > 0;
  const showChildren = isExpanded && hasChildren;
  return (
    <li>
      <div
        role="presentation"
        {...fileDrop.handlers}
        className={cn(
          'group flex h-dense items-center rounded-sm text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          isOpenInList && 'bg-soft text-foreground',
          fileDrop.isOver && 'outline-2 outline-primary',
        )}
        style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
      >
        <ExpandToggle
          name={node.name}
          isExpanded={isExpanded}
          hasChildren={hasChildren}
          onToggle={() => setIsExpanded(!isExpanded)}
        />
        <FolderOpenButton node={node} isCurrent={isOpenInList} />
        <RowActions node={node} onEdit={onEdit} />
      </div>
      {showChildren && (
        <FolderList
          nodes={node.children}
          depth={depth + 1}
          view={view}
          onEdit={onEdit}
          onDrop={onDrop}
        />
      )}
    </li>
  );
}

/** One level of the folder tree, folding rows past `ROWS_SHOWN` under a "more" button. */
export function FolderList(props: TreeProps & { nodes: VirtualFolderNode[] }) {
  const { nodes, ...treeProps } = props;
  const [showAll, setShowAll] = useState(false);
  const visibleNodes = showAll ? nodes : nodes.slice(0, ROWS_SHOWN);
  const foldedCount = nodes.length - ROWS_SHOWN;
  const canFold = foldedCount > 0;
  // Lines the toggle up with the folder names, past the chevron.
  const toggleIndent = treeProps.depth * INDENT_REM + 1.25;
  return (
    <ul>
      {visibleNodes.map((node) => (
        <FolderRow key={node.key} {...treeProps} node={node} />
      ))}
      {canFold && (
        <li style={{ paddingLeft: `${toggleIndent}rem` }}>
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-subtle hover:text-foreground"
          >
            {showAll ? t('Fewer') : t('{count} more', { count: foldedCount })}
          </button>
        </li>
      )}
    </ul>
  );
}
