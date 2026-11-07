/**
 * The Folders screen, for virtual folders: the folder tree, the open folder's rule above its files,
 * and the inspector.
 */
import { t } from '../i18n/index.ts';
import { FolderHeart } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FileQuery } from '../../types.ts';
import { useTool, useViewOptions } from '../api.ts';
import { Filters } from '../components/filters.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { setView, useView, useWindow } from '../tabs.ts';
import { toFileQuery, type View } from '../view-query.ts';
import { useViewScope } from '../vfolder-query.ts';
import { useBrowseActions } from './browse-actions.ts';
import { QuickPreview, TagDialog } from './browse-dialogs.tsx';
import { FilterInput, ToolbarActions } from './browse-toolbar.tsx';
import { ViewFiles } from './browse.tsx';
import { FolderDialog } from './folders-new-dialog.tsx';
import { RuleBar } from './folders-rule-bar.tsx';
import { SuggestionCards } from './folders-suggestions.tsx';
import { FoldersTree } from './folders-tree.tsx';
import type { Editing } from './folders-tree-row.tsx';
import { Inspector } from './inspector.tsx';

/**
 * Opens the New folder dialog for a  tag, as Make a folder on Tags sends, and takes the
 * parameter out of the address so going back does not open it again.
 */
function useNewFolderParam(tag: string | undefined, onEdit: (editing: Editing) => void) {
  useEffect(() => {
    if (!tag) return;
    onEdit({ parent: null, seed: { tags: [tag], tag_match: 'all' } });
    setView({ newfolder: null });
  }, [tag, onEdit]);
}

/** The open folder's name, the text filter and the list's usual actions. */
function FolderTitle({ view, query }: { view: View; query: FileQuery }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        <FolderHeart aria-hidden className="size-3.5 shrink-0 text-subtle" />
        <span className="truncate">{view.vname ?? view.vfolder}</span>
      </span>
      <FilterInput view={view} />
      <ToolbarActions view={view} query={query} />
    </div>
  );
}

/** With no folder open: suggestions as cards while there are no folders, else a pointer left. */
function NoFolderOpen() {
  const { data: folderTree } = useTool('list_vfolders', {});
  if (!folderTree) return null;
  if (!folderTree.saved.length) return <SuggestionCards />;
  return (
    <p className="p-10 text-center text-sm text-subtle">
      {t('Pick a folder on the left to see its files.')}
    </p>
  );
}

type PaneProps = {
  view: View;
  listQuery?: FileQuery;
  displayQuery: FileQuery;
  onEdit: (editing: Editing) => void;
};

/** The middle pane: the open folder's rule and files, or what to do without one. */
function FolderPane({ view, listQuery, displayQuery, onEdit }: PaneProps) {
  if (!view.vfolder)
    return (
      <Pane id="list" minSize={320}>
        <NoFolderOpen />
      </Pane>
    );
  return (
    <Pane
      id="list"
      minSize={320}
      title={<FolderTitle view={view} query={displayQuery} />}
      subheader={
        <>
          <RuleBar view={view} onEdit={onEdit} />
          <Filters view={view} className="border-b bg-surface-1 px-3 py-1.5" />
        </>
      }
    >
      <ViewFiles view={view} listQuery={listQuery} displayQuery={displayQuery} />
    </Pane>
  );
}

/** Virtual folders: tree, open folder and inspector, with the folder editor and the tag dialogs. */
export function Folders() {
  const view = useView();
  const options = useViewOptions();
  const listQuery = useViewScope(view, options);
  const displayQuery = listQuery ?? toFileQuery(view, options);
  const showTree = useWindow((s) => s.sidebar);
  const showInspector = useWindow((s) => s.inspector);
  const [editing, setEditing] = useState<Editing | null>(null);
  useBrowseActions(view);
  useNewFolderParam(view.newfolder, setEditing);

  const panes = ['list'];
  if (showTree) panes.unshift('folders-tree');
  if (showInspector) panes.push('inspector');
  return (
    <>
      <Panes id="folders" panes={panes}>
        {showTree && (
          <>
            <FoldersTree view={view} onEdit={setEditing} />
            <Divider />
          </>
        )}
        <FolderPane
          view={view}
          listQuery={listQuery}
          displayQuery={displayQuery}
          onEdit={setEditing}
        />
        {showInspector && (
          <>
            <Divider />
            <Inspector />
          </>
        )}
      </Panes>
      <FolderDialog editing={editing} onClose={() => setEditing(null)} />
      <TagDialog query={displayQuery} />
      <QuickPreview id={view.file} />
    </>
  );
}
