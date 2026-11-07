import { t } from '../i18n/index.ts';
import type { ReactNode } from 'react';
import type { Library } from '../../types.ts';
import { useTool } from '../api.ts';
import { Pane } from '../components/pane.tsx';
import { cn, formatCount, shortPath } from '../lib.ts';
import { setView } from '../tabs.ts';
import type { View } from '../view-query.ts';
import { FavoritesSection } from './browse-favorites.tsx';
import { SidebarGroup, TagGroups } from './browse-sidebar-tags.tsx';

const TYPES = [
  ['PDF', 'application/pdf'],
  ['Images', 'image/*'],
  ['Audio', 'audio/*'],
  ['Video', 'video/*'],
  ['Text', 'text/*'],
] as const;

const STATUSES = [
  ['New', 'new'],
  ['Organized', 'organized'],
  ['Failed', 'failed'],
] as const;

/** A row that turns a filter on or off, with an optional file count. */
function FilterRow(props: {
  isActive: boolean;
  onClick: () => void;
  count?: number;
  mono?: boolean;
  children: ReactNode;
}) {
  const { isActive, onClick, count, mono, children } = props;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        'flex h-dense w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        isActive && 'bg-soft text-foreground',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', mono && 'font-mono text-xs')}>{children}</span>
      {count !== undefined && (
        <span className="font-mono text-xs text-subtle">{formatCount(count)}</span>
      )}
    </button>
  );
}

/** Opens a library, or every library for `null`, leaving any virtual folder. */
const openLibrary = (folder: string | null) =>
  setView({ screen: 'browse', folder, file: null, vfolder: null, vname: null });

/** "All", then each library with its file count. */
function Libraries({ view, libraries }: { view: View; libraries: Library[] }) {
  const totalFiles = libraries.reduce((total, library) => total + library.files, 0);
  return (
    <SidebarGroup title={t('Libraries')} tour="library">
      <FilterRow
        isActive={!view.folder && !view.vfolder}
        count={totalFiles}
        onClick={() => openLibrary(null)}
      >
        {t('All')}
      </FilterRow>
      {libraries.map((library) => (
        <FilterRow
          key={library.path}
          mono
          isActive={view.folder === library.path}
          count={library.files}
          onClick={() => openLibrary(library.path)}
        >
          {shortPath(library.path)}
        </FilterRow>
      ))}
    </SidebarGroup>
  );
}

/** The type and status filters. A click on the active one turns it off. */
function TypeAndStatus({ view }: { view: View }) {
  return (
    <>
      <SidebarGroup title={t('Type')}>
        {TYPES.map(([label, mime]) => (
          <FilterRow
            key={mime}
            isActive={view.mime === mime}
            onClick={() => setView({ mime: view.mime === mime ? null : mime })}
          >
            {t(label)}
          </FilterRow>
        ))}
      </SidebarGroup>
      <SidebarGroup title={t('Status')}>
        {STATUSES.map(([label, status]) => (
          <FilterRow
            key={status}
            isActive={view.status === status}
            onClick={() => setView({ status: view.status === status ? null : status })}
          >
            {t(label)}
          </FilterRow>
        ))}
      </SidebarGroup>
    </>
  );
}

/** The left pane of the browser: libraries, favorite tags, tag groups, types and statuses. */
export function Sidebar({ view, libraries }: { view: View; libraries: Library[] }) {
  const { data: tags = [] } = useTool('list_tags', { folder: view.folder });
  return (
    <Pane id="sidebar" defaultSize="17%" minSize={180} maxSize="30%" className="pt-2.5">
      <Libraries view={view} libraries={libraries} />
      <FavoritesSection view={view} />
      <TagGroups tags={tags} view={view} />
      <TypeAndStatus view={view} />
    </Pane>
  );
}
