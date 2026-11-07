/** Dragging files from the list onto a virtual folder or a favorite tag. The data is file ids, never a path. */
import { useState, type DragEvent } from 'react';
import { useWindow } from './tabs.ts';

const TYPE = 'application/x-jevonganize-files';

/** Starts a drag of one file, or of the selection when that file is part of it. */
export function startFileDrag(e: DragEvent, id: number): void {
  const { ids } = useWindow.getState().selection;
  const dragged = ids.has(id) ? [...ids] : [id];
  e.dataTransfer.setData(TYPE, JSON.stringify(dragged));
  e.dataTransfer.effectAllowed = 'copy';
}

/** True while the drag over a target carries files. */
const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes(TYPE);

/** The file ids a drop carries. Anything else dropped gives none. */
function droppedFiles(e: DragEvent): number[] {
  try {
    const parsed: unknown = JSON.parse(e.dataTransfer.getData(TYPE) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Drag handlers for a target that takes files, and whether files are over it now. `onDrop` gets the
 * dropped ids. With no `onDrop` the target refuses every drag, and other drags pass through it.
 */
export function useFileDrop(onDrop: ((fileIds: number[]) => void) | null) {
  const [isOver, setIsOver] = useState(false);
  const handleDragOver = (e: DragEvent) => {
    if (!onDrop || !carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsOver(true);
  };
  const handleDrop = (e: DragEvent) => {
    if (!onDrop || !carriesFiles(e)) return;
    e.preventDefault();
    setIsOver(false);
    onDrop(droppedFiles(e));
  };
  const handlers = {
    onDragOver: handleDragOver,
    onDragLeave: () => setIsOver(false),
    onDrop: handleDrop,
  };
  return { isOver, handlers };
}
