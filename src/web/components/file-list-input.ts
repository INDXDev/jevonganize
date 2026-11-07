/** What keys and clicks do in a file list: the cursor, opening, and selection. */
import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import type { FileRow } from '../../types.ts';
import { clearSelection, useActions, useWindow } from '../tabs.ts';
import type { RowAt } from './file-list-state.ts';

const toggleSelected = (id: number) =>
  useWindow.setState(({ selection: { ids } }) => {
    const next = new Set(ids);
    if (!next.delete(id)) next.add(id);
    return { selection: { ids: next, all: false } };
  });

/**
 * Moves focus to the cursor after its row has rendered, and only for keyboard moves. Returns the
 * function a keyboard move calls first.
 */
export function useCursorFocus(root: RefObject<HTMLElement | null>, cursor: number) {
  const focusPending = useRef(false);
  useEffect(() => {
    if (!focusPending.current) return;
    const cell = root.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    if (cell) {
      cell.focus({ preventScroll: true });
      focusPending.current = false;
    }
  });
  return () => {
    focusPending.current = true;
  };
}

function selectRange(rowAt: RowAt, from: number, to: number) {
  const ids = new Set(useWindow.getState().selection.ids);
  for (let index = from; index <= to; index++) {
    const id = rowAt(index)?.id;
    if (id) ids.add(id);
  }
  useWindow.setState({ selection: { ids, all: false } });
}

type ListInput = {
  rowAt: RowAt;
  cursor: number;
  setCursor: (index: number) => void;
  focusNextCursor: () => void;
  total: number;
  columns: number;
  scrollToRow: (row: number) => void;
  keyboard?: boolean;
  onOpen?: (row: FileRow) => void;
  onCursor?: (row: FileRow) => void;
};

/** The list keys, and what a click on a row does. */
export function useListInput(input: ListInput) {
  const { rowAt, cursor, setCursor, total, columns, keyboard, onOpen, onCursor } = input;

  const moveCursor = (delta: number) => {
    if (!total) return;
    const next = Math.min(total - 1, Math.max(0, cursor + delta));
    input.focusNextCursor();
    setCursor(next);
    input.scrollToRow(Math.floor(next / columns));
    const row = rowAt(next);
    if (row) onCursor?.(row);
  };

  const openCursor = () => {
    const row = rowAt(cursor);
    if (row) onOpen?.(row);
    return row;
  };

  const actions = {
    down: () => moveCursor(columns),
    up: () => moveCursor(-columns),
    left: () => moveCursor(-1),
    right: () => moveCursor(1),
    open: openCursor,
    preview: () => openCursor() && useWindow.setState({ overlay: 'preview' }),
    select: () => {
      const row = rowAt(cursor);
      if (row) toggleSelected(row.id);
    },
    selectAll: () => useWindow.setState({ selection: { ids: new Set(), all: true } }),
  };
  useActions(keyboard ? actions : {});

  const click = (e: MouseEvent, index: number, row: FileRow) => {
    setCursor(index);
    if (e.metaKey || e.ctrlKey) {
      toggleSelected(row.id);
    } else if (e.shiftKey) {
      selectRange(rowAt, Math.min(cursor, index), Math.max(cursor, index));
    } else {
      if (keyboard) clearSelection();
      onOpen?.(row);
    }
  };

  return { click };
}
