import { t } from '../i18n/index.ts';
import { Folder } from 'lucide-react';
import type { FileQuery, Library } from '../../types.ts';
import { act, useTool, useViewOptions } from '../api.ts';
import { FileList } from '../components/file-list.tsx';
import { Filters } from '../components/filters.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { formatCount } from '../lib.ts';
import { notify, setView, useActions, useView, useWindow } from '../tabs.ts';
import { sortOf, toFileQuery, type View } from '../view-query.ts';
import { QuickPreview, TagDialog } from './browse-dialogs.tsx';
import { Sidebar } from './browse-sidebar.tsx';
import { Toolbar } from './browse-toolbar.tsx';
import { Inspector } from './inspector.tsx';

/** The folders directly under the open one, which is how a person walks down a library. */
function Subfolders({ folder }: { folder?: string }) {
  const { show_dotfiles } = useViewOptions();
  const { data = [] } = useTool('list_folders', { folder: folder! }, { enabled: !!folder });
  const shown = folder ? data.filter((sub) => show_dotfiles || !sub.name.startsWith('.')) : [];
  if (!shown.length) return null;
  return (
    <nav
      aria-label={t('Subfolders')}
      className="flex max-h-16 flex-wrap gap-1 overflow-y-auto border-b bg-surface-1 px-3 py-1.5"
    >
      {shown.map((sub) => (
        <button
          key={sub.path}
          type="button"
          title={sub.path}
          onClick={() => setView({ folder: sub.path, file: null })}
          className="flex h-6 max-w-56 items-center gap-1.5 rounded-sm border px-1.5 text-sm hover:bg-surface-2"
        >
          <Folder aria-hidden className="size-3.5 shrink-0 text-subtle" />
          <span className="min-w-0 truncate">{sub.name}</span>
          <span className="font-mono text-xs text-subtle">{formatCount(sub.files)}</span>
        </button>
      ))}
    </nav>
  );
}

/** Esc steps back one level: the selection, then the open file, then the filters. */
function clearOneLevel(view: View) {
  const { selection } = useWindow.getState();
  if (selection.all || selection.ids.size)
    useWindow.setState({ selection: { ids: new Set(), all: false } });
  else if (view.file) setView({ file: null });
  else setView({ tag: [], not: [], mime: null, status: null, text: null, match: null });
}

function useBrowseActions(view: View) {
  const openTagDialog = (overlay: 'tag' | 'untag') => {
    const { selection } = useWindow.getState();
    if (!view.file && !selection.all && !selection.ids.size)
      return notify(t('Select a file first'));
    return useWindow.setState({ overlay });
  };

  useActions({
    switchView: () => setView({ view: view.view === 'grid' ? 'list' : 'grid' }),
    tag: () => openTagDialog('tag'),
    untag: () => openTagDialog('untag'),
    matchTags: () => setView({ match: view.match === 'any' ? 'all' : 'any' }),
    reveal: () => view.file && void act('reveal_file', { id: view.file }),
    clear: () => clearOneLevel(view),
  });
}

function ListPane(props: { view: View; query: FileQuery; libraries: Library[] }) {
  const { view, query, libraries } = props;
  return (
    <Pane
      id="list"
      minSize={320}
      title={<Toolbar view={view} query={query} libraries={libraries} />}
      subheader={
        <>
          <Filters view={view} className="border-b bg-surface-1 px-3 py-1.5" />
          <Subfolders folder={view.folder} />
        </>
      }
    >
      <FileList
        keyboard
        mode={view.view}
        label={t('Files')}
        query={query}
        activeId={view.file}
        onOpen={(row) => setView({ file: row.id })}
        onCursor={(row) => view.file && setView({ file: row.id })}
        onSort={(sort) => {
          const current = sortOf(query);
          const flipped = current.order === 'asc' ? 'desc' : 'asc';
          setView({ sort, order: current.sort === sort ? flipped : null });
        }}
      />
    </Pane>
  );
}

/** The file browser: sidebar, list and inspector. */
export function Browse() {
  const view = useView();
  const query = toFileQuery(view, useViewOptions());
  const sidebar = useWindow((s) => s.sidebar);
  const inspector = useWindow((s) => s.inspector);
  const { data: libraries = [] } = useTool('list_libraries', {});
  useBrowseActions(view);

  const panes = [sidebar && 'sidebar', 'list', inspector && 'inspector'].filter(
    Boolean,
  ) as string[];
  return (
    <>
      <Panes id="browse" panes={panes}>
        {sidebar && (
          <>
            <Sidebar view={view} libraries={libraries} />
            <Divider />
          </>
        )}
        <ListPane view={view} query={query} libraries={libraries} />
        {inspector && (
          <>
            <Divider />
            <Inspector />
          </>
        )}
      </Panes>
      <TagDialog query={query} />
      <QuickPreview id={view.file} />
    </>
  );
}
