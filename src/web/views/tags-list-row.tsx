/** One row of the tag tree: its toggle, colour, label and counts, and the drag events it takes. */
import { t } from '../i18n/index.ts';
import { ChevronRight } from 'lucide-react';
import type { DragEvent } from 'react';
import type { TagNode } from '../../types.ts';
import { FavoriteStar } from '../components/favorite-star.tsx';
import { TagColorPicker } from '../components/tag-color-picker.tsx';
import { cn, formatCount } from '../lib.ts';
import { setView } from '../tabs.ts';
import { fixedReason, type DropSpot } from './tags-drag.ts';

/** A node on screen, how deep it sits in what is shown, and whether its children show. */
export type Row = { node: TagNode; level: number; expanded: boolean };

/** The counts of a row: files with the tag itself, then with it or a tag under it. */
function Counts({ node }: { node: TagNode }) {
  return (
    <>
      <span className="w-12 text-right font-mono text-xs text-subtle">
        {node.implicit ? '' : formatCount(node.direct)}
      </span>
      <span className="w-12 text-right font-mono text-xs text-subtle">
        {formatCount(node.total)}
      </span>
    </>
  );
}

/** The chevron that opens or closes a row's children. Hidden, but kept for alignment, on a leaf. */
function ExpandToggle({ row, onToggle }: { row: Row; onToggle: () => void }) {
  const name = row.node.label;
  const label = row.expanded ? t('Collapse {name}', { name }) : t('Expand {name}', { name });
  const isLeaf = !row.node.children.length;
  return (
    <button
      type="button"
      aria-label={label}
      className={cn('grid size-4 place-items-center text-subtle', isLeaf && 'invisible')}
      onClick={onToggle}
    >
      <ChevronRight className={cn('size-3', row.expanded && 'rotate-90')} />
    </button>
  );
}

/** A row's look: selected, a drop target, or the line a drop between rows would land on. */
function rowClassName(selected: boolean, dropSpot?: DropSpot) {
  const isDropTarget = dropSpot?.between === false;
  const isDropLine = dropSpot?.between === true;
  return cn(
    'group flex h-row items-center gap-1.5 border-y border-transparent pr-3 hover:bg-surface-2',
    selected && 'bg-soft',
    isDropTarget && 'bg-soft ring-1 ring-primary ring-inset',
    isDropLine && 'border-t-primary',
  );
}

type RowProps = {
  row: Row;
  selected: boolean;
  dropSpot?: DropSpot;
  onToggle: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent<HTMLLIElement>) => void;
  onDrop: () => void;
};

/**
 * One node: open or close, its label, and its counts. A facet's root opens; a tag selects. A tag on
 * files has a star, shown on hover until it is starred; a facet's root or an implicit parent has none.
 */
export function TreeRow(props: RowProps) {
  const { row, selected, dropSpot, onToggle, onDragStart, onDragOver, onDrop } = props;
  const { node, level } = row;
  const isRoot = node.depth === 0;
  const labelClass = cn(
    'min-w-0 flex-1 truncate text-left text-sm',
    isRoot && 'label',
    node.implicit && !isRoot && 'text-muted-foreground italic',
  );
  const select = () => setView({ tag: [node.path] });
  return (
    <li
      role="treeitem"
      aria-level={level + 1}
      aria-expanded={node.children.length ? row.expanded : undefined}
      aria-selected={selected}
      draggable={node.movable}
      title={fixedReason(node)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', node.path);
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={rowClassName(selected, dropSpot)}
      style={{ paddingLeft: `${0.75 + level}rem` }}
    >
      <ExpandToggle row={row} onToggle={onToggle} />
      {!isRoot && <TagColorPicker tag={node.path} />}
      {!isRoot && !node.implicit && (
        <FavoriteStar
          tag={node.path}
          className="size-4 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100"
        />
      )}
      <button type="button" className={labelClass} onClick={isRoot ? onToggle : select}>
        {node.label}
      </button>
      <Counts node={node} />
    </li>
  );
}
