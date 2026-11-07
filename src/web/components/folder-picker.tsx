import { t } from '../i18n/index.ts';
import { ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import type { DirListing } from '../../types.ts';
import { useTool } from '../api.ts';
import { lastSegment, pathSep } from '../view-query.ts';
import {
  ColumnHeadings,
  EntryRow,
  PathBar,
  Places,
  type Entry,
  type SortOrder,
} from './folder-picker-parts.tsx';
import { Button } from './ui/button.tsx';
import { Dialog } from './ui/dialog.tsx';
import { Checkbox, Input } from './ui/field.tsx';

const compareNames = (a: Entry, b: Entry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, as they are what can be chosen, each group in the order asked for. */
function sortEntries(entries: Entry[], { column, ascending }: SortOrder) {
  const compare = (a: Entry, b: Entry) =>
    column === 'name'
      ? compareNames(a, b)
      : (a[column] ?? 0) - (b[column] ?? 0) || compareNames(a, b);
  return entries.toSorted((a, b) => {
    const foldersFirst = Number(b.dir) - Number(a.dir);
    return foldersFirst || (ascending ? compare(a, b) : compare(b, a));
  });
}

/** The entries whose name holds `filterText`, without dot entries unless they are asked for. */
function filterEntries(entries: Entry[], filterText: string, showHidden: boolean) {
  const wanted = filterText.toLowerCase();
  return entries.filter(({ name }) => {
    const hiddenAllowed = showHidden || !name.startsWith('.');
    return hiddenAllowed && name.toLowerCase().includes(wanted);
  });
}

/** The path of `name` inside `folder`. The root `/` must not give `//name`. */
const childPath = (folder: string, name: string) =>
  `${folder}${pathSep(folder)}${name}`.replace(/^\/\//, '/');

/** The folder name an up or down arrow selects next, staying inside the list. */
function folderAfterArrow(folderNames: string[], selectedName: string | undefined, down: boolean) {
  const selectedIndex = selectedName === undefined ? -1 : folderNames.indexOf(selectedName);
  const nextIndex = Math.min(Math.max(selectedIndex + (down ? 1 : -1), 0), folderNames.length - 1);
  return folderNames[nextIndex];
}

/** Back and forward through the folders visited, as a browser does. */
function useFolderHistory() {
  const [{ visited, position }, setHistory] = useState({
    visited: [undefined] as (string | undefined)[],
    position: 0,
  });
  return {
    currentPath: visited[position],
    canGoBack: position > 0,
    canGoForward: position < visited.length - 1,
    goBack: () => setHistory({ visited, position: position - 1 }),
    goForward: () => setHistory({ visited, position: position + 1 }),
    visit: (path: string) =>
      setHistory({ visited: [...visited.slice(0, position + 1), path], position: position + 1 }),
  };
}

/** The listing on screen, what is selected in it, and the moves between folders. */
function useFolderBrowser(open: boolean) {
  const history = useFolderHistory();
  const { data: listing, error } = useTool(
    'browse_dirs',
    { path: history.currentPath },
    { enabled: open },
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>({ column: 'name', ascending: true });
  const [filterText, setFilterText] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [selectedName, setSelectedName] = useState<string>();

  const visibleEntries = useMemo(() => {
    const kept = filterEntries(listing?.entries ?? [], filterText, showHidden);
    return sortEntries(kept, sortOrder);
  }, [listing, filterText, showHidden, sortOrder]);

  const pathOf = (name: string) => childPath(listing?.path ?? '', name);
  const openFolder = (path: string) => {
    setSelectedName(undefined);
    setFilterText('');
    history.visit(path);
  };
  const openParent = () => listing?.parent && openFolder(listing.parent);
  const pickedPath = selectedName === undefined ? listing?.path : pathOf(selectedName);

  const onArrowKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return; // arrows move the caret there
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const folderNames = visibleEntries.filter((entry) => entry.dir).map((entry) => entry.name);
      const next = folderAfterArrow(folderNames, selectedName, e.key === 'ArrowDown');
      if (next !== undefined) setSelectedName(next);
    } else if (e.key === 'ArrowRight' && selectedName !== undefined) {
      openFolder(pathOf(selectedName));
    } else if (e.key === 'ArrowLeft') {
      openParent();
    }
  };

  return {
    history,
    listing,
    error,
    visibleEntries,
    pickedPath,
    sortOrder,
    setSortOrder,
    filterText,
    setFilterText,
    showHidden,
    setShowHidden,
    selectedName,
    setSelectedName,
    pathOf,
    openFolder,
    openParent,
    onArrowKey,
  };
}

type Browser = ReturnType<typeof useFolderBrowser>;

function Toolbar({ browser }: { browser: Browser }) {
  const { history, listing, filterText, showHidden } = browser;
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1.5">
      <Button
        variant="ghost"
        icon
        aria-label={t('Back')}
        disabled={!history.canGoBack}
        onClick={history.goBack}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        icon
        aria-label={t('Forward')}
        disabled={!history.canGoForward}
        onClick={history.goForward}
      >
        <ChevronRight />
      </Button>
      <Button
        variant="ghost"
        icon
        aria-label={t('Parent folder')}
        disabled={!listing?.parent}
        onClick={browser.openParent}
      >
        <ChevronUp />
      </Button>
      <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
        {listing && lastSegment(listing.path)}
      </span>
      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox
          checked={showHidden}
          onCheckedChange={(on) => browser.setShowHidden(on === true)}
        />
        {t('Hidden items')}
      </label>
      <Input
        aria-label={t('Filter this folder')}
        placeholder={t('Filter this folder')}
        value={filterText}
        onChange={(e) => browser.setFilterText(e.target.value)}
        className="w-40"
      />
    </div>
  );
}

function EntryList({ browser, listing }: { browser: Browser; listing?: DirListing }) {
  const { visibleEntries, error, selectedName } = browser;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ColumnHeadings sortOrder={browser.sortOrder} onSort={browser.setSortOrder} />
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {error && <p className="p-2 text-sm text-destructive">{error.message}</p>}
        {visibleEntries.map((entry) => (
          <EntryRow
            key={entry.name}
            entry={entry}
            selected={entry.name === selectedName}
            onSelect={() => browser.setSelectedName(entry.name)}
            onOpen={() => browser.openFolder(browser.pathOf(entry.name))}
          />
        ))}
        {listing && visibleEntries.length === 0 && (
          <p className="p-2 text-sm text-subtle">{t('No subfolders.')}</p>
        )}
      </div>
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
  const browser = useFolderBrowser(open);
  const { listing, pickedPath } = browser;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Choose a folder')}
      onKeyDown={browser.onArrowKey}
      className="h-[68vh] w-[52rem] max-w-[92vw]"
    >
      <Toolbar browser={browser} />
      <div className="flex min-h-0 flex-1">
        <Places places={listing?.places ?? []} current={listing?.path} onGo={browser.openFolder} />
        <EntryList browser={browser} listing={listing} />
      </div>
      <div className="flex items-center gap-2 border-t px-2 py-1.5">
        {listing && <PathBar path={listing.path} onGo={browser.openFolder} />}
        <Button variant="ghost" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!pickedPath}
          onClick={() => pickedPath && onPick(pickedPath)}
        >
          {t('Use this folder')}
        </Button>
      </div>
    </Dialog>
  );
}
