import { t } from '../i18n/index.ts';
import { AlertTriangle, ArrowDown, ArrowUp, Check, CircleDashed } from 'lucide-react';
import { useState } from 'react';
import type { ViewOptions } from '../../core/config.ts';
import type { FileQuery, FileRow } from '../../types.ts';
import { fileUrl, thumbUrl } from '../api.ts';
import { cn, formatDate, formatSize, shortPath } from '../lib.ts';
import { displayName, kindOf } from '../view-options.ts';
import { sortOf } from '../view-query.ts';
import { FileIcon } from './file-icon.tsx';
import { TagChip } from './tag-chip.tsx';

const MAX_CHIPS = 3;

function Thumb(props: { row: FileRow; large?: boolean; fit?: ViewOptions['thumbnail_fit'] }) {
  const { row, large, fit = 'cover' } = props;
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className="grid size-full place-items-center">
        <FileIcon mime={row.mime} className="size-7 stroke-1" />
      </div>
    );
  const frame = cn(
    'absolute inset-0 size-full',
    fit === 'cover' ? 'object-cover' : 'object-contain',
  );
  // The browser draws a frame itself, so this needs no tool on any OS.
  if (row.mime?.startsWith('video/'))
    return (
      // oxlint-disable-next-line jsx-a11y/media-has-caption -- a still, never played
      <video
        src={`${fileUrl(row.id)}#t=0.5`}
        preload="metadata"
        muted
        onError={() => setFailed(true)}
        className={cn(frame, 'pointer-events-none')}
      />
    );
  // A page starts at its top left. A photo is best cut evenly.
  const cropFrom = row.mime?.startsWith('image/') ? 'object-top' : 'object-left-top';
  return (
    <img
      src={thumbUrl(row, large ? 1024 : 256)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn(frame, fit === 'contain' ? 'object-center' : cropFrom)}
    />
  );
}

function Status({ status }: { status: FileRow['status'] }) {
  if (status === 'failed')
    return <AlertTriangle aria-label={t('Failed')} className="size-3 shrink-0 text-warn" />;
  if (status === 'new')
    return <CircleDashed aria-label={t('Not organized')} className="size-3 shrink-0 text-subtle" />;
  return null;
}

/** What a `Tile` or a `Line` draws. `shared` carries the ARIA and events of its cell. */
export type Item = {
  row: FileRow;
  on: boolean;
  active: boolean;
  shared: Record<string, unknown>;
  options: ViewOptions;
};

function GridInfo({ row, info }: { row: FileRow; info: ViewOptions['grid_info'] }) {
  if (info === 'none') return null;
  const text = {
    tags: row.tags[0] ?? t('untagged'),
    kind: kindOf(row),
    size: formatSize(row.size),
    modified: formatDate(row.mtime_ms),
  }[info];
  return (
    <div className="flex h-4 justify-between gap-2 font-mono text-2xs text-subtle">
      <span className="truncate">{text}</span>
      {info === 'tags' && (
        <span className="shrink-0">{row.tags.length > 1 && `+${row.tags.length - 1}`}</span>
      )}
    </div>
  );
}

// Past this width, the small thumbnail would show its pixels.
const LARGE_TILE = 256;

/** One file in the grid. */
export function Tile({ row, on, active, shared, options, tile }: Item & { tile: number }) {
  return (
    <div {...shared} className="group flex min-w-0 flex-col gap-1.5 rounded-md outline-offset-2">
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden rounded-md border bg-surface-2 group-hover:border-strong',
          active && 'border-primary',
          on && 'border-primary outline-1 outline-primary',
        )}
      >
        <Thumb row={row} large={tile > LARGE_TILE} fit={options.thumbnail_fit} />
        {on && (
          <span className="absolute top-1.5 left-1.5 grid size-4 place-items-center rounded-sm bg-primary text-primary-foreground">
            <Check className="size-3" strokeWidth={3} aria-label={t('Selected')} />
          </span>
        )}
      </div>
      <div className="px-0.5">
        <div className="flex items-center gap-1">
          <span
            title={row.name}
            className={cn('min-w-0 flex-1 truncate', active && 'text-primary')}
          >
            {displayName(row.name, options.show_extensions)}
          </span>
          <Status status={row.status} />
        </div>
        <GridInfo row={row} info={options.grid_info} />
      </div>
    </div>
  );
}

type Column = ViewOptions['list_columns'][number];

// In `em`, so a column holds its text at any text size.
const COLUMN_WIDTHS: Record<Column, string> = {
  tags: 'minmax(0,5fr)',
  kind: '8em',
  size: '6em',
  modified: '7.5em',
  path: 'minmax(0,4fr)',
};

const COLUMN_NAMES = {
  tags: 'Tags',
  kind: 'Kind',
  size: 'Size',
  modified: 'Modified',
  path: 'Folder',
} as const;

const SORTABLE = { kind: 'kind', size: 'size', modified: 'modified' } as const;

const columnsClass = 'grid items-center gap-3 px-3';
const columnsStyle = (columns: Column[]) => ({
  gridTemplateColumns: ['minmax(0,8fr)', ...columns.map((c) => COLUMN_WIDTHS[c])].join(' '),
});

const right = (column: Column) => column === 'size' || column === 'modified';

function Cell({ row, column }: { row: FileRow; column: Column }) {
  if (column === 'tags')
    return (
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
    );
  const text = {
    kind: kindOf(row),
    size: formatSize(row.size),
    modified: formatDate(row.mtime_ms),
    path: shortPath(row.path.slice(0, -row.name.length - 1)),
  }[column];
  return (
    <span
      title={column === 'path' ? text : undefined}
      className={cn(
        'truncate font-mono text-[0.9em] text-muted-foreground',
        right(column) && 'text-right',
      )}
    >
      {text}
    </span>
  );
}

/** One file in the list. */
export function Line({ row, on, active, shared, options }: Item) {
  const icon = options.list_thumbnails ? (
    <span className="relative size-8 shrink-0 overflow-hidden rounded-sm border bg-surface-2">
      <Thumb row={row} fit={options.thumbnail_fit} />
    </span>
  ) : (
    <FileIcon mime={row.mime} />
  );
  return (
    <div
      {...shared}
      style={columnsStyle(options.list_columns)}
      className={cn(
        columnsClass,
        'h-full -outline-offset-2 hover:bg-surface-2',
        (on || active) && 'bg-soft',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {on ? <Check className="size-4 shrink-0 text-primary" aria-label={t('Selected')} /> : icon}
        <span title={row.name} className="truncate">
          {displayName(row.name, options.show_extensions)}
        </span>
        <Status status={row.status} />
      </span>
      {options.list_columns.map((column) => (
        <Cell key={column} row={row} column={column} />
      ))}
    </div>
  );
}

/** The column heads of the list, which sort it. */
export function Header(props: {
  query: FileQuery;
  columns: Column[];
  onSort: (sort: NonNullable<FileQuery['sort']>) => void;
}) {
  const { query, columns, onSort } = props;
  const current = sortOf(query);
  const Arrow = current.order === 'asc' ? ArrowUp : ArrowDown;
  const head = (sort: NonNullable<FileQuery['sort']>, text: string, end?: boolean) => (
    <button
      key={sort}
      type="button"
      onClick={() => onSort(sort)}
      className={cn('label flex items-center gap-1 hover:text-foreground', end && 'justify-end')}
    >
      {text}
      {current.sort === sort && <Arrow className="size-2.5" />}
    </button>
  );
  return (
    <div
      style={columnsStyle(columns)}
      className={cn(columnsClass, 'sticky top-0 z-10 h-7 border-b bg-surface-1')}
    >
      {head('name', t('Name'))}
      {columns.map((column) =>
        column in SORTABLE ? (
          head(SORTABLE[column as keyof typeof SORTABLE], t(COLUMN_NAMES[column]), right(column))
        ) : (
          <span key={column} className="label">
            {t(COLUMN_NAMES[column])}
          </span>
        ),
      )}
    </div>
  );
}

/** Stands in for a row that has not loaded. */
export function Skeleton({ grid }: { grid: boolean }) {
  return grid ? (
    <div className="shimmer rounded-md bg-surface-2" />
  ) : (
    <div className="shimmer mx-3 my-2 h-3 rounded-sm bg-surface-2" />
  );
}
