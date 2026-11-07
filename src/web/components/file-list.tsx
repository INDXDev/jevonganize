import { t } from '../i18n/index.ts';
import type { VirtualItem } from '@tanstack/react-virtual';
import { useRef, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import type { FileQuery, FileRow } from '../../types.ts';
import { act } from '../api.ts';
import { startFileDrag } from '../file-drag.ts';
import { cn } from '../lib.ts';
import { useWindow } from '../tabs.ts';
import {
  type RowAt,
  useCursorFocus,
  useFirstPage,
  useListInput,
  useListMetrics,
  usePublishTotal,
  useRowLookup,
  useVirtualRows,
} from './file-list-state.ts';
import { FileIcon } from './file-icon.tsx';
import { Header, Line, Skeleton, Tile } from './file-row.tsx';
import { usePaneScroller } from './pane.tsx';

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

type Metrics = ReturnType<typeof useListMetrics>;

/** What every cell of a list needs to draw itself. */
type CellView = Metrics & {
  grid: boolean;
  cursor: number;
  activeId?: number;
  picked: (id: number) => boolean;
  rowAt: RowAt;
  onClick: (e: MouseEvent, i: number, row: FileRow) => void;
  onDoubleClick?: (id: number) => void;
  onFocus: (index: number) => void;
};

function FileCell({ index, view }: { index: number; view: CellView }) {
  const { grid, columns, cursor, activeId, picked, options, layout } = view;
  const row = view.rowAt(index);
  if (!row) return <Skeleton grid={grid} />;
  const on = picked(row.id);
  const active = row.id === activeId;
  const shared = {
    'data-index': index,
    role: 'gridcell',
    tabIndex: index === cursor ? 0 : -1,
    'aria-selected': on || active,
    'aria-colindex': grid ? (index % columns) + 1 : 1,
    onClick: (e: MouseEvent) => view.onClick(e, index, row),
    onDoubleClick: () => view.onDoubleClick?.(row.id),
    onFocus: () => view.onFocus(index),
    draggable: true,
    onDragStart: (e: DragEvent) => startFileDrag(e, row.id),
  };
  const item = { row, on, active, shared, options };
  return grid ? <Tile {...item} tile={layout.tile} /> : <Line {...item} />;
}

function VirtualRow(props: { item: VirtualItem; total: number; view: CellView }) {
  const { item, total, view } = props;
  const { grid, columns, layout, head, rowAt } = view;
  const indexes = Array.from({ length: columns }, (_, c) => item.index * columns + c);
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="row"
      aria-rowindex={item.index + 1}
      className={cn('absolute inset-x-0 top-0', grid && 'grid grid-rows-[minmax(0,1fr)]')}
      style={{
        height: item.size,
        transform: `translateY(${item.start - head}px)`,
        gridTemplateColumns: grid ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
        gap: grid ? layout.gap : undefined,
        paddingTop: grid ? layout.gap : undefined,
      }}
    >
      {indexes
        .filter((i) => i < total)
        .map((i) => (
          <FileCell key={rowAt(i)?.id ?? i} index={i} view={view} />
        ))}
    </div>
  );
}

function VirtualList(props: Props & { query: FileQuery }) {
  const { mode, query, label, activeId, onOpen, onCursor, keyboard, onSort, empty } = props;
  const grid = mode === 'grid';
  const scroller = usePaneScroller();
  const root = useRef<HTMLDivElement>(null);
  const selection = useWindow((s) => s.selection);
  const metrics = useListMetrics(grid, Boolean(onSort), scroller);
  const { columns, head, options } = metrics;

  const first = useFirstPage(query);
  const total = first.data?.total ?? 0;
  const list = { total, metrics, keyboard };
  const { virtual, cursor, setCursor } = useVirtualRows(query, scroller, list);
  const items = virtual.getVirtualItems();
  const rowAt = useRowLookup(query, first.data, items, columns);
  usePublishTotal(keyboard, total, Boolean(first.data));
  const focusNextCursor = useCursorFocus(root, cursor);
  const scrollToRow = (row: number) => virtual.scrollToIndex(row);
  const input = { rowAt, cursor, setCursor, focusNextCursor, total, columns, scrollToRow };
  const { click } = useListInput({ ...input, keyboard, onOpen, onCursor });

  if (first.error)
    return <p className="p-6 text-center text-sm text-destructive">{first.error.message}</p>;
  if (first.data && !total)
    return (
      empty ?? (
        <p className="p-10 text-center text-sm text-subtle">{t('No files match this view.')}</p>
      )
    );

  const view: CellView = {
    ...metrics,
    grid,
    cursor,
    activeId,
    picked: (id) => selection.all || selection.ids.has(id),
    rowAt,
    onClick: click,
    onDoubleClick: keyboard ? (id) => void act('open_file', { id }) : undefined,
    onFocus: setCursor,
  };
  return (
    <div
      ref={root}
      role="grid"
      aria-label={label}
      aria-rowcount={virtual.options.count}
      aria-colcount={columns}
      data-list
      className={cn('leading-normal', grid && 'px-3')}
      style={{ fontSize: `${options.text_size / 16}rem` }}
    >
      {head > 0 && <Header query={query} onSort={onSort!} columns={options.list_columns} />}
      <div className="relative" style={{ height: virtual.getTotalSize() - head }}>
        {items.map((item) => (
          <VirtualRow key={item.key} item={item} total={total} view={view} />
        ))}
      </div>
    </div>
  );
}
