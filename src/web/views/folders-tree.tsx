import { t } from '../i18n/index.ts';
import { ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import type { VirtualFolder, VirtualFolderNode } from '../../types.ts';
import { useTool } from '../api.ts';
import { Pane } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn } from '../lib.ts';
import type { View } from '../view-query.ts';
import { useFolderPlans } from './folders-plans.tsx';
import { SuggestedFolders } from './folders-suggestions.tsx';
import { FolderList } from './folders-tree-list.tsx';
import type { Editing } from './folders-tree-row.tsx';

/** A new folder starts from the tab's tag filters. One tag or none narrows best with "all". */
const seedFromView = (view: View): Editing['seed'] => ({
  tags: view.tag,
  tag_match: view.tag.length > 1 ? view.match : 'all',
  exclude_tags: view.not,
});

/** The button in the pane's title that starts a new top-level folder. */
function NewFolderButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      icon
      className="size-6"
      aria-label={t('New folder')}
      title={t('New folder')}
      onClick={onClick}
    >
      <Plus />
    </Button>
  );
}

/** The folders the person saved, which take dropped files and open the editor. */
function SavedFolders(props: {
  savedFolders: VirtualFolderNode[];
  view: View;
  onEdit: (editing: Editing) => void;
  onDrop: (folder: VirtualFolder, fileIds: number[]) => void;
}) {
  const { savedFolders, view, onEdit, onDrop } = props;
  if (!savedFolders.length) {
    return (
      <p className="px-2 text-xs text-subtle">
        {t('No folders yet. A folder collects every file whose tags match its rule.')}
      </p>
    );
  }
  return <FolderList nodes={savedFolders} depth={0} view={view} onEdit={onEdit} onDrop={onDrop} />;
}

/** One folder per tag, made on demand. They load only once the toggle is opened. */
function GeneratedFolders({ view }: { view: View }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: generatedTree } = useTool(
    'list_vfolders',
    { generated: true },
    { enabled: isExpanded },
  );
  return (
    <div className="pt-2">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex h-dense w-full items-center gap-1 px-1 text-xs text-subtle hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', isExpanded && 'rotate-90')} />
        {t('Auto: one folder per tag')}
      </button>
      {isExpanded && <FolderList nodes={generatedTree?.generated ?? []} depth={0} view={view} />}
    </div>
  );
}

/** The left pane of Folders: the saved tree, then suggestions, then the generated tree on demand. */
export function FoldersTree({ view, onEdit }: { view: View; onEdit: (editing: Editing) => void }) {
  const { data: folderTree } = useTool('list_vfolders', {});
  const folderPlans = useFolderPlans();
  return (
    <Pane
      id="folders-tree"
      defaultSize="20%"
      minSize={200}
      maxSize="35%"
      title={t('Folders (virtual)')}
      actions={
        <NewFolderButton onClick={() => onEdit({ parent: null, seed: seedFromView(view) })} />
      }
    >
      <div data-tour="vfolders" className="px-1.5 py-2">
        <SavedFolders
          savedFolders={folderTree?.saved ?? []}
          view={view}
          onEdit={onEdit}
          onDrop={(folder, fileIds) => void folderPlans.addFiles(folder, fileIds)}
        />
        <SuggestedFolders />
        <GeneratedFolders view={view} />
      </div>
      {folderPlans.dialog}
    </Pane>
  );
}
