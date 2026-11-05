import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CircleDashed,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Mail,
} from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { FileQuery, FileRow } from '../../types.ts';
import { call, thumbUrl } from '../api.ts';
import { cn, formatDate, formatSize } from '../lib.ts';
import { clearSelection, useActions, useWindow } from '../tabs.ts';
import { usePaneScroller } from './pane.tsx';
import { TagChip } from './tag-chip.tsx';

const PAGE = 500;
const MAX_CHIPS = 3;

export function FileIcon({ mime, className }: { mime: string | null; className?: string }) {
  const m = mime ?? '';
  const Icon = m.startsWith('image/')
    ? FileImage
    : m.startsWith('audio/')
      ? FileMusic
      : m.startsWith('video/')
        ? FileVideo
        : /sheet|excel|csv/.test(m)
          ? FileSpreadsheet
          : /zip|tar|gzip/.test(m)
            ? FileArchive
            : /rfc822|outlook/.test(m)
              ? Mail
              : /json|javascript|typescript|html|xml|x-/.test(m)
                ? FileCode
                : /^text|pdf|word|document|presentation/.test(m)
                  ? FileText
                  : File;
  return <Icon aria-hidden className={cn('size-4 shrink-0 text-subtle', className)} />;
}

const thumbable = (mime: string | null) => /^(image|video)\/|pdf/.test(mime ?? '');

function Thumb({ row }: { row: FileRow }) {
  const [failed, setFailed] = useState(false);
  return thumbable(row.mime) && !failed ? (
    <img
      src={thumbUrl(row)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover object-top"
    />
  ) : (
    <div className="grid size-full place-items-center">
      <FileIcon mime={row.mime} className="size-7 stroke-1" />
    </div>
  );
}

function Status({ status }: { status: FileRow['status'] }) {
  if (status === 'failed')
    return <AlertTriangle aria-label="Failed" className="size-3 shrink-0 text-warn" />;
  if (status === 'new')
    return <CircleDashed aria-label="Not organized" className="size-3 shrink-0 text-subtle" />;
  return null;
}

type Props = {
  mode: 'grid' | 'list' | 'compact';
  label: string;
  /** A paged, virtualised source. Without it, `rows` render as they are: keep those short. */
  query?: FileQuery;
  rows?: FileRow[];
  activeId?: number;
  onOpen?: (row: FileRow) => void;
  /** The keyboard cursor moved to a row. */
  onCursor?: (row: FileRow) => void;
  /** The main list of a view: it takes the list keys, and selection. */
  keyboard?: boolean;
  onSort?: (sort: NonNullable<FileQuery['sort']>) => void;
  /** Right side of a compact row. */
  renderTrailing?: (row: FileRow) => ReactNode;
  /** Second line of a compact row. */
  renderDetail?: (row: FileRow) => ReactNode;
  empty?: ReactNode;
};

/** The only way to show files: grid, list or compact. Owns virtualisation, keyboard and ARIA. */
export function FileList(props: Props) {
  return props.query ? <VirtualList {...props} query={props.query} /> : <PlainList {...props} />;
}

function PlainList({
  rows = [],
  label,
  activeId,
  onOpen,
  renderTrailing,
  renderDetail,
  empty,
}: Props) {
  if (!rows.length) return empty ?? null;
  return (
    <div role="grid" aria-label={label} aria-rowcount={rows.length}>
      {rows.map((row, i) => (
        // ARIA grid, as docs/ui.md requires: table tags cannot be virtualised.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        <div key={row.id} role="row" aria-rowindex={i + 1}>
          <button
            type="button"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="gridcell"
            aria-selected={row.id === activeId}
            onClick={() => onOpen?.(row)}
            className={cn(
              'block w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-3',
              row.id === activeId && 'bg-soft',
            )}
          >
            <span className="flex items-center gap-2">
              <FileIcon mime={row.mime} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
              {renderTrailing?.(row)}
            </span>
            {renderDetail && (
              <span className="mt-0.5 flex gap-1 overflow-hidden pl-5.5">{renderDetail(row)}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

const toggle = (id: number) =>
  useWindow.setState(({ selection: { ids } }) => {
    const next = new Set(ids);
    if (!next.delete(id)) next.add(id);
    return { selection: { ids: next, all: false } };
  });

const search = (query: FileQuery, page: number) => ({
  queryKey: ['search_files', { ...query, limit: PAGE, offset: page * PAGE }],
  queryFn: () => call('search_files', { ...query, limit: PAGE, offset: page * PAGE }),
});

function VirtualList(props: Props & { query: FileQuery }) {
  const { mode, query, label, activeId, onOpen, onCursor, keyboard, onSort, empty } = props;
  const grid = mode === 'grid';
  const scroller = usePaneScroller();
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState(0);
  const rem = 16 * useWindow((s) => s.scale);
  const compact = useWindow((s) => s.density) === 'compact';
  const selection = useWindow((s) => s.selection);

  const columns = grid ? Math.max(1, Math.floor(width / ((compact ? 8.5 : 10) * rem))) : 1;
  const rowHeight = (grid ? (compact ? 10 : 11.75) : compact ? 1.5 : 1.75) * rem;
  const head = !grid && onSort ? 1.75 * rem : 0;

  const first = useQuery({ ...search(query, 0), placeholderData: keepPreviousData });
  const total = first.data?.total ?? 0;

  // oxlint-disable-next-line react/incompatible-library -- no compiler here, and the list needs it
  const virtual = useVirtualizer({
    count: Math.ceil(total / columns),
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: 6,
    scrollMargin: head,
  });
  const items = virtual.getVirtualItems();

  const pages = [
    ...new Set(items.flatMap((v) => [v.index * columns, v.index * columns + columns - 1])),
  ]
    .map((i) => Math.floor(i / PAGE))
    .filter((p, i, all) => p > 0 && all.indexOf(p) === i);
  const rest = useQueries({ queries: pages.map((p) => search(query, p)) });
  const loaded = new Map([[0, first.data], ...pages.map((p, i) => [p, rest[i]?.data] as const)]);
  const rowAt = (i: number) => loaded.get(Math.floor(i / PAGE))?.files[i % PAGE];

  useEffect(() => {
    const observer = new ResizeObserver(([e]) => setWidth(e!.contentRect.width - 1.5 * rem));
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller, rem]);

  useEffect(() => {
    virtual.measure();
  }, [rowHeight, virtual]);

  const key = JSON.stringify(query);
  useEffect(() => {
    setCursor(0);
    scroller?.scrollTo({ top: 0 });
    if (keyboard) clearSelection();
  }, [key, scroller, keyboard]);

  useEffect(() => {
    if (keyboard) useWindow.setState({ total: first.data ? total : null });
    return () => {
      if (keyboard) useWindow.setState({ total: null });
    };
  }, [keyboard, total, first.data]);

  // Focus follows the cursor after the row has rendered, and only for keyboard moves.
  useEffect(() => {
    if (!refocus.current) return;
    const cell = root.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    if (cell) {
      cell.focus({ preventScroll: true });
      refocus.current = false;
    }
  });

  const move = (delta: number) => {
    if (!total) return;
    const next = Math.min(total - 1, Math.max(0, cursor + delta));
    refocus.current = true;
    setCursor(next);
    virtual.scrollToIndex(Math.floor(next / columns));
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

  const onClick = (e: MouseEvent, i: number, row: FileRow) => {
    setCursor(i);
    if (e.metaKey || e.ctrlKey) {
      toggle(row.id);
    } else if (e.shiftKey) {
      const [from, to] = [Math.min(cursor, i), Math.max(cursor, i)];
      const ids = new Set(selection.ids);
      for (let n = from; n <= to; n++) {
        const id = rowAt(n)?.id;
        if (id) ids.add(id);
      }
      useWindow.setState({ selection: { ids, all: false } });
    } else {
      if (keyboard) clearSelection();
      onOpen?.(row);
    }
  };

  if (first.error)
    return <p className="p-6 text-center text-sm text-destructive">{first.error.message}</p>;
  if (first.data && !total)
    return (
      empty ?? <p className="p-10 text-center text-sm text-subtle">No files match this view.</p>
    );

  const picked = (id: number) => selection.all || selection.ids.has(id);
  const cell = (i: number, row: FileRow | undefined) => {
    const shared = {
      'data-index': i,
      role: 'gridcell',
      tabIndex: i === cursor ? 0 : -1,
      'aria-selected': row ? picked(row.id) || row.id === activeId : false,
      'aria-colindex': grid ? (i % columns) + 1 : 1,
      onClick: (e: MouseEvent) => row && onClick(e, i, row),
      onFocus: () => setCursor(i),
    };
    if (!row) return <Skeleton key={i} grid={grid} />;
    const state = { on: picked(row.id), active: row.id === activeId };
    return grid ? (
      <Tile key={row.id} row={row} {...state} shared={shared} />
    ) : (
      <Line key={row.id} row={row} {...state} shared={shared} />
    );
  };

  return (
    <div
      ref={root}
      role="grid"
      aria-label={label}
      aria-rowcount={virtual.options.count}
      aria-colcount={columns}
      data-list
      className={cn(grid && 'px-3')}
    >
      {head > 0 && <Header query={query} onSort={onSort!} />}
      <div className="relative" style={{ height: virtual.getTotalSize() - head }}>
        {items.map((v) => (
          <div
            key={v.key}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="row"
            aria-rowindex={v.index + 1}
            className={cn(
              'absolute inset-x-0 top-0',
              grid && 'grid grid-rows-[minmax(0,1fr)] gap-2.5 pt-3',
            )}
            style={{
              height: v.size,
              transform: `translateY(${v.start - head}px)`,
              gridTemplateColumns: grid ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
            }}
          >
            {Array.from({ length: columns }, (_, c) => v.index * columns + c)
              .filter((i) => i < total)
              .map((i) => cell(i, rowAt(i)))}
          </div>
        ))}
      </div>
    </div>
  );
}

type Item = {
  row: FileRow;
  on: boolean;
  active: boolean;
  shared: Record<string, unknown>;
};

function Tile({ row, on, active, shared }: Item) {
  return (
    <div {...shared} className="group flex min-w-0 flex-col gap-1.5 rounded-md outline-offset-2">
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden rounded-md border bg-surface-2 group-hover:border-strong',
          active && 'border-primary',
          on && 'border-primary outline-1 outline-primary',
        )}
      >
        <Thumb row={row} />
        {on && (
          <span className="absolute top-1.5 left-1.5 grid size-4 place-items-center rounded-sm bg-primary text-primary-foreground">
            <Check className="size-3" strokeWidth={3} aria-label="Selected" />
          </span>
        )}
      </div>
      <div className="px-0.5">
        <div className="flex items-center gap-1">
          <span className={cn('min-w-0 flex-1 truncate text-sm', active && 'text-primary')}>
            {row.name}
          </span>
          <Status status={row.status} />
        </div>
        <div className="flex justify-between gap-2 font-mono text-2xs text-subtle">
          <span className="truncate">{row.tags[0] ?? 'untagged'}</span>
          <span className="shrink-0">{row.tags.length > 1 && `+${row.tags.length - 1}`}</span>
        </div>
      </div>
    </div>
  );
}

const columnsClass =
  'grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)_4.5rem_5.5rem] items-center gap-3 px-3';

function Line({ row, on, active, shared }: Item) {
  return (
    <div
      {...shared}
      className={cn(
        columnsClass,
        'h-full -outline-offset-2 hover:bg-surface-2',
        (on || active) && 'bg-soft',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {on ? (
          <Check className="size-4 shrink-0 text-primary" aria-label="Selected" />
        ) : (
          <FileIcon mime={row.mime} />
        )}
        <span className="truncate">{row.name}</span>
        <Status status={row.status} />
      </span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {row.tags.slice(0, MAX_CHIPS).map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {row.tags.length > MAX_CHIPS && (
          <span className="shrink-0 font-mono text-xs text-subtle">
            +{row.tags.length - MAX_CHIPS}
          </span>
        )}
      </span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {formatSize(row.size)}
      </span>
      <span className="text-right font-mono text-xs text-muted-foreground">
        {formatDate(row.mtime_ms)}
      </span>
    </div>
  );
}

function Header(props: {
  query: FileQuery;
  onSort: (sort: NonNullable<FileQuery['sort']>) => void;
}) {
  const { query, onSort } = props;
  const Arrow = query.order === 'asc' ? ArrowUp : ArrowDown;
  const head = (sort: NonNullable<FileQuery['sort']>, text: string, right?: boolean) => (
    <button
      type="button"
      onClick={() => onSort(sort)}
      className={cn('label flex items-center gap-1 hover:text-foreground', right && 'justify-end')}
    >
      {text}
      {(query.sort ?? 'modified') === sort && <Arrow className="size-2.5" />}
    </button>
  );
  return (
    <div className={cn(columnsClass, 'sticky top-0 z-10 h-7 border-b bg-surface-1')}>
      {head('name', 'Name')}
      <span className="label">Tags</span>
      {head('size', 'Size', true)}
      {head('modified', 'Modified', true)}
    </div>
  );
}

function Skeleton({ grid }: { grid: boolean }) {
  return grid ? (
    <div className="shimmer rounded-md bg-surface-2" />
  ) : (
    <div className="shimmer mx-3 my-2 h-3 rounded-sm bg-surface-2" />
  );
}
