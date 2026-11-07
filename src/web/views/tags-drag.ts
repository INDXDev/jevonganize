/** Dragging a tag in the tree onto another: where it may land, and the move it asks for. */
import { t } from '../i18n/index.ts';
import { useState, type DragEvent } from 'react';
import type { TagNode } from '../../types.ts';

/** Where a dragged tag would land: on a row, which becomes its parent, or between rows, the top. */
export type DropSpot = { path: string; between: boolean };

/** Moves a tag under a parent, or to the top for null. */
export type MoveTag = (from: string, parent: string | null) => void;

/** A tag below its facet's first level, which can move to the top. */
const isNested = (node: TagNode) => node.depth > 1;

/** The path one level up: `topic:a/b` gives `topic:a`. Only for a nested tag. */
const parentPath = (path: string) => path.slice(0, path.lastIndexOf('/'));

/**
 * True when `target` can become the parent of `dragged`. move_tag refuses a move across facets, under
 * the tag itself or under a tag below it, and a move to the parent it has now changes nothing.
 */
function canMoveUnder(dragged: TagNode, target: TagNode): boolean {
  const isSameFacet = target.facet === dragged.facet;
  const isSelf = target.path === dragged.path;
  const isBelowDragged = target.path.startsWith(`${dragged.path}/`);
  const isParentNow = isNested(dragged) && parentPath(dragged.path) === target.path;
  return isSameFacet && !isSelf && !isBelowDragged && !isParentNow;
}

/**
 * What a drop asks of move_tag: the new parent, null for the top of the facet, or undefined when the
 * drop would do nothing. Between rows, and on a facet's root, means the top.
 */
export function dropParent(dragged: TagNode, target: TagNode, between: boolean) {
  const isTopDrop = between || target.depth === 0;
  if (isTopDrop) return isNested(dragged) ? null : undefined;
  return canMoveUnder(dragged, target) ? target.path : undefined;
}

/** Where the pointer is over a row: its top or bottom quarter means between rows. */
function dropSpotAt(e: DragEvent<HTMLElement>, path: string): DropSpot {
  const box = e.currentTarget.getBoundingClientRect();
  const offset = (e.clientY - box.top) / box.height;
  return { path, between: offset < 0.25 || offset > 0.75 };
}

/** Why a row cannot be dragged, for its tooltip. A facet's root needs no reason. */
export function fixedReason(node: TagNode) {
  const isFixedTag = node.depth > 0 && !node.movable;
  return isFixedTag ? t('A closed facet has fixed labels, so this tag cannot move.') : undefined;
}

/** The drag in progress: which tag, where it would land, and the handlers rows attach. */
export function useTreeDrag(onMove: MoveTag) {
  const [draggedNode, setDraggedNode] = useState<TagNode>();
  const [dropSpot, setDropSpot] = useState<DropSpot>();
  const reset = () => {
    setDraggedNode(undefined);
    setDropSpot(undefined);
  };
  // Only a spot where a drop would plan a move accepts the drag, so the cursor shows the rest refuse.
  const handleDragOver = (target: TagNode) => (e: DragEvent<HTMLLIElement>) => {
    if (!draggedNode) return;
    const spotUnderPointer = dropSpotAt(e, target.path);
    const parent = dropParent(draggedNode, target, spotUnderPointer.between);
    if (parent === undefined) return;
    e.preventDefault();
    const isSameSpot =
      spotUnderPointer.path === dropSpot?.path && spotUnderPointer.between === dropSpot.between;
    if (!isSameSpot) setDropSpot(spotUnderPointer);
  };
  const handleDrop = (target: TagNode) => {
    if (draggedNode && dropSpot) {
      const parent = dropParent(draggedNode, target, dropSpot.between);
      if (parent !== undefined) onMove(draggedNode.path, parent);
    }
    reset();
  };
  return { dropSpot, beginDrag: setDraggedNode, handleDragOver, handleDrop, reset };
}
