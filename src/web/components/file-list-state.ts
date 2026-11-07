/** The state behind a virtual file list: its size, its pages, its cursor and its input. */
import { useQueries, useQuery, keepPreviousData } from '@tanstack/react-query';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { FileQuery, FileRow } from '../../types.ts';
import { call, useViewOptions } from '../api.ts';
import { clearSelection, useActions, useWindow } from '../tabs.ts';
import { gridLayout, lineHeight } from '../view-options.ts';

const PAGE = 500;
/** How long a page must stay on screen to be worth fetching: a fast scroll passes through many. */
const SETTLE_MS = 120;

const search = (query: FileQuery, page: number) => ({
  queryKey: ['search_files', { ...query, limit: PAGE, offset: page * PAGE }],
  // Taking the signal is what lets a page that left the screen cancel its request.
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    call('search_files', { ...query, limit: PAGE, offset: page * PAGE }, signal),
});

const toggle = (id: number) =>
  useWindow.setState(({ selection: { ids } }) => {
    const next = new Set(ids);
    if (!next.delete(id)) next.add(id);
    return { selection: { ids: next, all: false } };
  });

/** Looks a file up by its place in the list. It is `undefined` until its page has loaded. */
export type RowAt = (index: number) => FileRow | undefined;

/** How big rows are, from the width of the scroller and the view options. */
export function useListMetrics(grid: boolean, sortable: boolean, scroller: HTMLElement | null) {
  const [width, setWidth] = useState(0);
  const rem = 16 * useWindow((s) => s.scale);
  const compact = useWindow((s) => s.density) === 'compact';
  const options = useViewOptions();
  const layout = gridLayout(width, rem, options);

  useEffect(() => {
    const observer = new ResizeObserver(([e]) => setWidth(e!.contentRect.width - 1.5 * rem));
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller, rem]);

  return {
    options,
    layout,
    columns: grid ? layout.columns : 1,
    rowHeight: grid ? layout.rowHeight : lineHeight(rem, (compact ? 1.5 : 1.75) * rem, options),
    head: !grid && sortable ? 1.75 * rem : 0,
  };
}

/** The first page, which holds the total. It stays on screen while the next query loads. */
export const useFirstPage = (query: FileQuery) =>
  useQuery({ ...search(query, 0), placeholderData: keepPreviousData });

/** Loads the pages under the visible rows. */
export function useRowLookup(
  query: FileQuery,
  first: ReturnType<typeof useFirstPage>['data'],
  items: VirtualItem[],
  columns: number,
): RowAt {
  const pages = [
    ...new Set(items.flatMap((v) => [v.index * columns, v.index * columns + columns - 1])),
  ]
    .map((i) => Math.floor(i / PAGE))
    .filter((p, i, all) => p > 0 && all.indexOf(p) === i);
  const onScreen = pages.join();
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettled(onScreen), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [onScreen]);
  // A disabled query still gives what is cached, so only pages never seen wait.
  const wanted = new Set(settled.split(','));
  const rest = useQueries({
    queries: pages.map((p) => ({ ...search(query, p), enabled: wanted.has(String(p)) })),
  });
  const loaded = new Map([[0, first], ...pages.map((p, i) => [p, rest[i]?.data] as const)]);
  return (i) => loaded.get(Math.floor(i / PAGE))?.files[i % PAGE];
}

/**
 * The virtual rows and the keyboard cursor. A new query starts both over, with the selection.
 */
export function useVirtualRows(
  query: FileQuery,
  scroller: HTMLElement | null,
  list: { total: number; metrics: ReturnType<typeof useListMetrics>; keyboard?: boolean },
) {
  const { total, keyboard } = list;
  const { columns, rowHeight, head } = list.metrics;
  const [cursor, setCursor] = useState(0);

  // oxlint-disable-next-line react/incompatible-library -- no compiler here, and the list needs it
  const virtual = useVirtualizer({
    count: Math.ceil(total / columns),
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: 6,
    scrollMargin: head,
  });

  useEffect(() => {
    virtual.measure();
  }, [rowHeight, virtual]);

  const key = JSON.stringify(query);
  useEffect(() => {
    setCursor(0);
    scroller?.scrollTo({ top: 0 });
    if (keyboard) clearSelection();
  }, [key, scroller, keyboard]);

  return { virtual, cursor, setCursor };
}

/** Moves focus to the cursor after its row has rendered, and only for keyboard moves. */
export function useCursorFocus(root: RefObject<HTMLElement | null>, cursor: number) {
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    const cell = root.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    if (cell) {
      cell.focus({ preventScroll: true });
      refocus.current = false;
    }
  });
  return () => {
    refocus.current = true;
  };
}

/** Shares the total with the window while this list holds the keyboard. */
export function usePublishTotal(keyboard: boolean | undefined, total: number, known: boolean) {
  useEffect(() => {
    if (keyboard) useWindow.setState({ total: known ? total : null });
    return () => {
      if (keyboard) useWindow.setState({ total: null });
    };
  }, [keyboard, total, known]);
}

function selectRange(rowAt: RowAt, from: number, to: number) {
  const ids = new Set(useWindow.getState().selection.ids);
  for (let n = from; n <= to; n++) {
    const id = rowAt(n)?.id;
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

  const move = (delta: number) => {
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
    down: () => move(columns),
    up: () => move(-columns),
    left: () => move(-1),
    right: () => move(1),
    open: openCursor,
    preview: () => openCursor() && useWindow.setState({ overlay: 'preview' }),
    select: () => {
      const row = rowAt(cursor);
      if (row) toggle(row.id);
    },
    selectAll: () => useWindow.setState({ selection: { ids: new Set(), all: true } }),
  };
  useActions(keyboard ? actions : {});

  const click = (e: MouseEvent, i: number, row: FileRow) => {
    setCursor(i);
    if (e.metaKey || e.ctrlKey) {
      toggle(row.id);
    } else if (e.shiftKey) {
      selectRange(rowAt, Math.min(cursor, i), Math.max(cursor, i));
    } else {
      if (keyboard) clearSelection();
      onOpen?.(row);
    }
  };

  return { click };
}
