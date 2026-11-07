/** Dragging files from the list onto a virtual folder. The data is file ids, never a path. */
import type { DragEvent } from 'react';
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
export const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes(TYPE);

/** The file ids a drop carries. Anything else dropped gives none. */
export function droppedFiles(e: DragEvent): number[] {
  try {
    const parsed: unknown = JSON.parse(e.dataTransfer.getData(TYPE) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}
