import { t } from '../i18n/index.ts';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  File,
  Folder,
  House,
} from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import type { DirListing } from '../../types.ts';
import { useTool } from '../api.ts';
import { cn, formatDate, formatSize } from '../lib.ts';
import { lastSegment, pathSep } from '../view-query.ts';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { Checkbox, Input } from './ui/field.tsx';

type Entry = DirListing['entries'][number];
type Column = 'name' | 'modified' | 'size';
type Sort = { by: Column; up: boolean };

const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_10rem_5rem] items-center gap-2 px-2';

const byName = (a: Entry, b: Entry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, as they are what can be chosen, each group in the sort asked for. */
function sorted(entries: Entry[], { by, up }: Sort) {
  const order = (a: Entry, b: Entry) =>
    by === 'name' ? byName(a, b) : (a[by] ?? 0) - (b[by] ?? 0) || byName(a, b);
  return entries.toSorted(
    (a, b) => Number(b.dir) - Number(a.dir) || (up ? order(a, b) : order(b, a)),
  );
}

/** Back and forward through the folders visited, as a browser does. */
function useHistory() {
  const [{ stack, at }, setHistory] = useState({
    stack: [undefined] as (string | undefined)[],
    at: 0,
  });
  return {
    path: stack[at],
    canBack: at > 0,
    canForward: at < stack.length - 1,
    back: () => setHistory({ stack, at: at - 1 }),
    forward: () => setHistory({ stack, at: at + 1 }),
    go: (path: string) => setHistory({ stack: [...stack.slice(0, at + 1), path], at: at + 1 }),
  };
}

function Header(props: { sort: Sort; onSort: (sort: Sort) => void }) {
  const { sort, onSort } = props;
  const Arrow = sort.up ? ChevronUp : ChevronDown;
  const heading = (by: Column, label: string, right?: boolean) => (
    <button
      type="button"
      aria-pressed={sort.by === by}
      onClick={() => onSort({ by, up: sort.by === by ? !sort.up : by === 'name' })}
      className={cn('flex items-center gap-1 hover:text-foreground', right && 'justify-end')}
    >
      {label}
      {sort.by === by && <Arrow className="size-3" />}
    </button>
  );
  return (
    <div className={cn(COLUMNS, 'h-row border-b text-xs text-muted-foreground')}>
      {heading('name', t('Name'))}
      {heading('modified', t('Date modified'))}
      {heading('size', t('Size'), true)}
    </div>
  );
}

function Row(props: { entry: Entry; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const { entry, selected, onSelect, onOpen } = props;
  const Icon = entry.dir ? Folder : File;
  return (
    <button
      type="button"
      disabled={!entry.dir}
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        COLUMNS,
        'h-row w-full rounded-sm text-left text-sm',
        entry.dir ? 'hover:bg-surface-3' : 'text-subtle',
        selected && 'bg-primary text-primary-foreground hover:bg-primary',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', entry.dir && 'fill-current opacity-70')} />
        <span className="truncate">{entry.name}</span>
      </span>
      <span className="truncate text-xs tabular-nums opacity-70">
        {entry.modified === null ? '—' : formatDate(entry.modified)}
      </span>
      <span className="text-right text-xs tabular-nums opacity-70">
        {entry.dir || entry.size === null ? '—' : formatSize(entry.size)}
      </span>
    </button>
  );
}

function Places(props: { places: string[]; current?: string; onGo: (path: string) => void }) {
  const { places, current, onGo } = props;
  return (
    <nav aria-label={t('Places')} className="w-36 shrink-0 overflow-y-auto border-r p-1">
      {places.map((place, index) => {
        const Icon = index === 0 ? House : Folder;
        return (
          <button
            key={place}
            type="button"
            aria-current={place === current ? 'page' : undefined}
            onClick={() => onGo(place)}
            className={cn(
              'flex h-row w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-surface-3',
              place === current && 'bg-soft',
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
function PathBar({ path, onGo }: { path: string; onGo: (path: string) => void }) {
  const sep = pathSep(path);
  const parts = path.split(sep).filter(Boolean);
  const upTo = (index: number) => {
    const joined = parts.slice(0, index + 1).join(sep);
    return sep === '/' ? `/${joined}` : index === 0 ? joined + sep : joined;
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <span key={upTo(index)} className="flex min-w-0 items-center gap-0.5">
          {index > 0 && <ChevronRight className="size-3 shrink-0" />}
          <button
            type="button"
            onClick={() => onGo(upTo(index))}
            className="truncate hover:text-foreground"
          >
            {part}
          </button>
        </span>
      ))}
    </div>
  );
}

/** Browses folders through `browse_dirs`, as a Finder window does. Files show but cannot be chosen. */
export function FolderPicker(props: {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const { open, onClose, onPick } = props;
  const history = useHistory();
  const { data, error } = useTool('browse_dirs', { path: history.path }, { enabled: open });
  const [sort, setSort] = useState<Sort>({ by: 'name', up: true });
  const [filter, setFilter] = useState('');
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string>();

  const shown = useMemo(() => {
    const wanted = filter.toLowerCase();
    const kept = (data?.entries ?? []).filter(
      ({ name }) => (hidden || !name.startsWith('.')) && name.toLowerCase().includes(wanted),
    );
    return sorted(kept, sort);
  }, [data, filter, hidden, sort]);

  const child = (name: string) =>
    `${data?.path}${pathSep(data?.path ?? '/')}${name}`.replace(/^\/\//, '/');
  const go = (path: string) => {
    setSelected(undefined);
    setFilter('');
    history.go(path);
  };

  const move = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return; // arrows move the caret there
    const dirs = shown.filter((entry) => entry.dir).map((entry) => entry.name);
    const at = selected === undefined ? -1 : dirs.indexOf(selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next =
        dirs[Math.min(Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0), dirs.length - 1)];
      if (next !== undefined) setSelected(next);
    } else if (e.key === 'ArrowRight' && selected !== undefined) {
      go(child(selected));
    } else if (e.key === 'ArrowLeft' && data?.parent) {
      go(data.parent);
    }
  };

  const chosen = selected === undefined ? data?.path : child(selected);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Choose a folder')}
      onKeyDown={move}
      className="h-[68vh] w-[52rem] max-w-[92vw]"
    >
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          icon
          aria-label={t('Back')}
          disabled={!history.canBack}
          onClick={history.back}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          icon
          aria-label={t('Forward')}
          disabled={!history.canForward}
          onClick={history.forward}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          icon
          aria-label={t('Parent folder')}
          disabled={!data?.parent}
          onClick={() => data?.parent && go(data.parent)}
        >
          <ChevronUp />
        </Button>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {data && lastSegment(data.path)}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={hidden} onCheckedChange={(on) => setHidden(on === true)} />
          {t('Hidden items')}
        </label>
        <Input
          aria-label={t('Filter this folder')}
          placeholder={t('Filter this folder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <Places places={data?.places ?? []} current={data?.path} onGo={go} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header sort={sort} onSort={setSort} />
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {error && <p className="p-2 text-sm text-destructive">{error.message}</p>}
            {shown.map((entry) => (
              <Row
                key={entry.name}
                entry={entry}
                selected={entry.name === selected}
                onSelect={() => setSelected(entry.name)}
                onOpen={() => go(child(entry.name))}
              />
            ))}
            {data && shown.length === 0 && (
              <p className="p-2 text-sm text-subtle">{t('No subfolders.')}</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t px-2 py-1.5">
        {data && <PathBar path={data.path} onGo={go} />}
        <Button variant="ghost" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
          {t('Use this folder')}
        </Button>
      </div>
    </Dialog>
  );
}
