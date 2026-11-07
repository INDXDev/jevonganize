/** The pieces of the folder picker that only draw: column heads, a row, places and the path bar. */
import { t } from '../i18n/index.ts';
import { ChevronDown, ChevronRight, ChevronUp, File, Folder, House } from 'lucide-react';
import type { DirListing } from '../../types.ts';
import { cn, formatDate, formatSize } from '../lib.ts';
import { lastSegment, pathSep } from '../view-query.ts';

/** One file or folder in a listing. */
export type Entry = DirListing['entries'][number];

type SortColumn = 'name' | 'modified' | 'size';

/** Which column orders the entries, and whether the smallest comes first. */
export type SortOrder = { column: SortColumn; ascending: boolean };

const GRID_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_10rem_5rem] items-center gap-2 px-2';

/** Name, date and size heads. A click sorts by that column, and a second click reverses it. */
export function ColumnHeadings(props: {
  sortOrder: SortOrder;
  onSort: (sortOrder: SortOrder) => void;
}) {
  const { sortOrder, onSort } = props;
  const Arrow = sortOrder.ascending ? ChevronUp : ChevronDown;
  const heading = (column: SortColumn, label: string, alignRight?: boolean) => {
    const active = sortOrder.column === column;
    // A new column starts in its natural order: names A to Z, dates and sizes largest first.
    const ascending = active ? !sortOrder.ascending : column === 'name';
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onSort({ column, ascending })}
        className={cn('flex items-center gap-1 hover:text-foreground', alignRight && 'justify-end')}
      >
        {label}
        {active && <Arrow className="size-3" />}
      </button>
    );
  };
  return (
    <div className={cn(GRID_COLUMNS, 'h-row border-b text-xs text-muted-foreground')}>
      {heading('name', t('Name'))}
      {heading('modified', t('Date modified'))}
      {heading('size', t('Size'), true)}
    </div>
  );
}

/** One entry. Only folders can be selected or opened. */
export function EntryRow(props: {
  entry: Entry;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { entry, selected, onSelect, onOpen } = props;
  const Icon = entry.dir ? Folder : File;
  const modified = entry.modified === null ? '—' : formatDate(entry.modified);
  const size = entry.dir || entry.size === null ? '—' : formatSize(entry.size);
  return (
    <button
      type="button"
      disabled={!entry.dir}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        GRID_COLUMNS,
        'h-row w-full rounded-sm text-left text-sm',
        entry.dir ? 'hover:bg-surface-3' : 'text-subtle',
        selected && 'bg-primary text-primary-foreground hover:bg-primary',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', entry.dir && 'fill-current opacity-70')} />
        <span className="truncate">{entry.name}</span>
      </span>
      <span className="truncate text-xs tabular-nums opacity-70">{modified}</span>
      <span className="text-right text-xs tabular-nums opacity-70">{size}</span>
    </button>
  );
}

/** The side list of well-known folders. The first is the home folder. */
export function Places(props: {
  places: string[];
  current?: string;
  onGo: (path: string) => void;
}) {
  const { places, current, onGo } = props;
  return (
    <nav aria-label={t('Places')} className="w-36 shrink-0 overflow-y-auto border-r p-1">
      {places.map((place, index) => {
        const Icon = index === 0 ? House : Folder;
        const isCurrent = place === current;
        return (
          <button
            key={place}
            type="button"
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => onGo(place)}
            className={cn(
              'flex h-row w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-surface-3',
              isCurrent && 'bg-soft',
            )}
          >
            <Icon className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{lastSegment(place)}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** The path as links, one per folder above this one. */
export function PathBar({ path, onGo }: { path: string; onGo: (path: string) => void }) {
  const separator = pathSep(path);
  const segments = path.split(separator).filter(Boolean);
  const pathThrough = (index: number) => {
    const joined = segments.slice(0, index + 1).join(separator);
    if (separator === '/') return `/${joined}`;
    // A Windows drive needs its backslash: `C:` alone means the drive's current folder.
    return index === 0 ? joined + separator : joined;
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
      {segments.map((segment, index) => (
        <span key={pathThrough(index)} className="flex min-w-0 items-center gap-0.5">
          {index > 0 && <ChevronRight className="size-3 shrink-0" />}
          <button
            type="button"
            onClick={() => onGo(pathThrough(index))}
            className="truncate hover:text-foreground"
          >
            {segment}
          </button>
        </span>
      ))}
    </div>
  );
}
