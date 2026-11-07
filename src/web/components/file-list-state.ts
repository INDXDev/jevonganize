/** The state behind a virtual file list: its size, its pages and its cursor. Input is in file-list-input.ts. */
import { useQueries, useQuery, keepPreviousData } from '@tanstack/react-query';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useEffect, useState } from 'react';
import type { FileQuery, FileRow } from '../../types.ts';
import { call, useViewOptions } from '../api.ts';
import { clearSelection, useWindow } from '../tabs.ts';
import { gridLayout, lineHeight } from '../view-options.ts';

/** Files per request. A page is fetched whole, and cached whole. */
const PAGE_SIZE = 500;
/** How long a page must stay on screen to be worth fetching: a fast scroll passes through many. */
const SETTLE_MS = 120;
/** Rows drawn beyond each edge of the viewport, so a short scroll shows no gap. */
const OVERSCAN_ROWS = 6;

const pageQuery = (query: FileQuery, page: number) => {
  const input = { ...query, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  return {
    queryKey: ['search_files', input],
    // Taking the signal is what lets a page that left the screen cancel its request.
    queryFn: ({ signal }: { signal: AbortSignal }) => call('search_files', input, signal),
  };
};

/** Looks a file up by its place in the list. It is `undefined` until its page has loaded. */
export type RowAt = (index: number) => FileRow | undefined;

/** How big rows are, from the width of the scroller and the view options. */
export function useListMetrics(grid: boolean, sortable: boolean, scroller: HTMLElement | null) {
  const [width, setWidth] = useState(0);
  const remPx = 16 * useWindow((s) => s.scale);
  const compact = useWindow((s) => s.density) === 'compact';
  const options = useViewOptions();
  const layout = gridLayout(width, remPx, options);

  useEffect(() => {
    // The grid's side padding is 0.75rem on each side, which the tiles cannot use.
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry!.contentRect.width - 1.5 * remPx),
    );
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller, remPx]);

  const lineRowHeight = lineHeight(remPx, (compact ? 1.5 : 1.75) * remPx, options);
  return {
    options,
    layout,
    columns: grid ? layout.columns : 1,
    rowHeight: grid ? layout.rowHeight : lineRowHeight,
    /** The height of the sortable column heads, or 0 when there are none. */
    head: !grid && sortable ? 1.75 * remPx : 0,
  };
}

/** The first page, which holds the total. It stays on screen while the next query loads. */
export const useFirstPage = (query: FileQuery) =>
  useQuery({ ...pageQuery(query, 0), placeholderData: keepPreviousData });

/** The pages after the first that the visible rows fall on, each once. */
function pagesUnder(items: VirtualItem[], columns: number) {
  const firstAndLastFiles = items.flatMap((item) => {
    const firstFile = item.index * columns;
    return [firstFile, firstFile + columns - 1];
  });
  const pages = firstAndLastFiles.map((fileIndex) => Math.floor(fileIndex / PAGE_SIZE));
  return [...new Set(pages)].filter((page) => page > 0);
}

/** `value`, once it has held still for `delayMs`. */
function useSettled(value: string, delayMs: number) {
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/** Loads the pages under the visible rows. */
export function useRowLookup(
  query: FileQuery,
  firstPage: ReturnType<typeof useFirstPage>['data'],
  items: VirtualItem[],
  columns: number,
): RowAt {
  const pages = pagesUnder(items, columns);
  const settledPages = new Set(useSettled(pages.join(), SETTLE_MS).split(','));
  // A disabled query still gives what is cached, so only pages never seen wait.
  const laterPages = useQueries({
    queries: pages.map((page) => ({
      ...pageQuery(query, page),
      enabled: settledPages.has(String(page)),
    })),
  });
  const loaded = new Map([
    [0, firstPage],
    ...pages.map((page, i) => [page, laterPages[i]?.data] as const),
  ]);
  return (index) => loaded.get(Math.floor(index / PAGE_SIZE))?.files[index % PAGE_SIZE];
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
    overscan: OVERSCAN_ROWS,
    scrollMargin: head,
  });

  useEffect(() => {
    virtual.measure();
  }, [rowHeight, virtual]);

  const queryKey = JSON.stringify(query);
  useEffect(() => {
    setCursor(0);
    scroller?.scrollTo({ top: 0 });
    if (keyboard) clearSelection();
  }, [queryKey, scroller, keyboard]);

  return { virtual, cursor, setCursor };
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
