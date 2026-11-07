import { t } from '../i18n/index.ts';
import type { FileQuery, Library } from '../../types.ts';
import { useTool, useViewOptions } from '../api.ts';
import { FileList } from '../components/file-list.tsx';
import { Filters } from '../components/filters.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { setView, useView, useWindow } from '../tabs.ts';
import { sortOf, toFileQuery, type View } from '../view-query.ts';
import { useBrowseActions } from './browse-actions.ts';
import { QuickPreview, TagDialog } from './browse-dialogs.tsx';
import { Sidebar } from './browse-sidebar.tsx';
import { Subfolders } from './browse-subfolders.tsx';
import { Toolbar } from './browse-toolbar.tsx';
import { Inspector } from './inspector.tsx';

/** A click on a column head: the same column flips its order, another sorts by its default. */
function sortBy(sort: NonNullable<FileQuery['sort']>, current: FileQuery) {
  const { sort: currentSort, order } = sortOf(current);
  const flipped = order === 'asc' ? 'desc' : 'asc';
  setView({ sort, order: currentSort === sort ? flipped : null });
}

/**
 * The tab's files, as the main list of a view. `listQuery` is undefined while a virtual folder's
 * rule loads, so the list waits; `displayQuery` stands in for it in the column heads meanwhile.
 */
export function ViewFiles(props: { view: View; listQuery?: FileQuery; displayQuery: FileQuery }) {
  const { view, listQuery, displayQuery } = props;
  return (
    <FileList
      keyboard
      mode={view.view}
      label={t('Files')}
      query={listQuery}
      activeId={view.file}
      onOpen={(row) => setView({ file: row.id })}
      onCursor={(row) => view.file && setView({ file: row.id })}
      onSort={(sort) => sortBy(sort, displayQuery)}
    />
  );
}

/** The file list with its toolbar and strips. */
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
      <ViewFiles view={view} listQuery={query} displayQuery={query} />
    </Pane>
  );
}

/** The file browser: sidebar, list and inspector. */
export function Browse() {
  const view = useView();
  const options = useViewOptions();
  const query = toFileQuery(view, options);
  const showSidebar = useWindow((s) => s.sidebar);
  const showInspector = useWindow((s) => s.inspector);
  const { data: libraries = [] } = useTool('list_libraries', {});
  useBrowseActions(view);

  const panes = ['list'];
  if (showSidebar) panes.unshift('sidebar');
  if (showInspector) panes.push('inspector');
  return (
    <>
      <Panes id="browse" panes={panes}>
        {showSidebar && (
          <>
            <Sidebar view={view} libraries={libraries} />
            <Divider />
          </>
        )}
        <ListPane view={view} query={query} libraries={libraries} />
        {showInspector && (
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
