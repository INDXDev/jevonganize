import { t } from '../i18n/index.ts';
import { ChevronRight, Pencil, Pin, Plus } from 'lucide-react';
import type { FolderRule, VirtualFolder, VirtualFolderNode } from '../../types.ts';
import { act } from '../api.ts';
import { useFileDrop } from '../file-drag.ts';
import { cn, formatCount } from '../lib.ts';
import { notify, setView } from '../tabs.ts';

/**
 * The folder being edited, or none for a new one, and the folder it sits in. A new folder starts
 * from `seed`, such as the tab's filters or the tags a selection shares.
 */
export type Editing = { folder?: VirtualFolder; parent: number | null; seed?: Partial<FolderRule> };

/** Called with a saved folder and the ids of the files dropped on it. */
export type DropFiles = (folder: VirtualFolder, fileIds: number[]) => void;

/** Opens a folder in the file list, on its own: tag filters and the library folder are cleared. */
const openFolder = (key: string, name: string) =>
  setView({
    screen: 'folders',
    vfolder: key,
    vname: name,
    folder: null,
    tag: [],
    not: [],
    file: null,
  });

/** Opens a saved folder, such as one just made. */
export const openSavedFolder = (folder: VirtualFolder) =>
  openFolder(String(folder.id), folder.name);

/** Saves a generated folder's tag as a folder of its own. */
async function pinGenerated(node: VirtualFolderNode) {
  const rule = { tags: [node.key], tag_match: 'all' as const };
  const pinned = await act('save_vfolder', { name: node.name, rule });
  if (pinned) notify(t('Pinned {name}', { name: pinned.name }));
}

/** Drag handlers for a row. Only a saved folder with a home tag takes files. */
export function useFolderDrop(folder: VirtualFolder | null, onDrop: DropFiles | undefined) {
  return useFileDrop(folder?.tag && onDrop ? (fileIds) => onDrop(folder, fileIds) : null);
}

/** A small icon-only button whose label is also its tooltip. */
function RowIconButton(props: {
  label: string;
  onClick: () => void;
  className: string;
  icon: typeof Plus;
}) {
  const { label, onClick, className, icon: Icon } = props;
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={className}>
      <Icon className="size-3" />
    </button>
  );
}

const HOVER_ACTION_CLASS = 'grid size-5 place-items-center text-subtle hover:text-foreground';

/** A saved folder's hover actions: a new folder inside it, and editing it. */
function SavedFolderActions(props: {
  name: string;
  folder: VirtualFolder;
  onEdit: (editing: Editing) => void;
}) {
  const { name, folder, onEdit } = props;
  return (
    <span className="hidden shrink-0 group-focus-within:flex group-hover:flex">
      <RowIconButton
        label={t('New folder inside {name}', { name })}
        icon={Plus}
        className={HOVER_ACTION_CLASS}
        onClick={() => onEdit({ parent: folder.id })}
      />
      <RowIconButton
        label={t('Edit {name}', { name })}
        icon={Pencil}
        className={HOVER_ACTION_CLASS}
        onClick={() => onEdit({ folder, parent: folder.parent })}
      />
    </span>
  );
}

/** The chevron that shows or hides a folder's children. Hidden for a folder with none. */
export function ExpandToggle(props: {
  name: string;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
}) {
  const { name, isExpanded, hasChildren, onToggle } = props;
  return (
    <button
      type="button"
      aria-label={isExpanded ? t('Collapse {name}', { name }) : t('Expand {name}', { name })}
      aria-expanded={isExpanded}
      disabled={!hasChildren}
      onClick={onToggle}
      className="grid size-5 shrink-0 place-items-center text-subtle disabled:invisible"
    >
      <ChevronRight className={cn('size-3 transition-transform', isExpanded && 'rotate-90')} />
    </button>
  );
}

/** The folder's name and file count, which opens it in the file list. */
export function FolderOpenButton({
  node,
  isCurrent,
}: {
  node: VirtualFolderNode;
  isCurrent: boolean;
}) {
  const dropHint = node.folder?.tag
    ? t('Drop files here to tag them {tag}', { tag: node.folder.tag })
    : undefined;
  return (
    <button
      type="button"
      aria-pressed={isCurrent}
      title={dropHint}
      onClick={() => openFolder(node.key, node.name)}
      className="flex h-full min-w-0 flex-1 items-center gap-2 pr-1 text-left"
    >
      <span className={cn('min-w-0 flex-1 truncate', !node.folder && 'font-mono text-xs')}>
        {node.name}
      </span>
      <span className="font-mono text-xs text-subtle">{formatCount(node.count)}</span>
    </button>
  );
}

/** Pin for a generated folder, edit and nest for a saved one, nothing for a read-only saved one. */
export function RowActions({
  node,
  onEdit,
}: {
  node: VirtualFolderNode;
  onEdit?: (editing: Editing) => void;
}) {
  const folder = node.folder;
  if (!folder) {
    return (
      <RowIconButton
        label={t('Pin {name} as a folder', { name: node.name })}
        icon={Pin}
        className="hidden size-5 shrink-0 place-items-center text-subtle group-focus-within:grid group-hover:grid hover:text-foreground"
        onClick={() => void pinGenerated(node)}
      />
    );
  }
  if (!onEdit) return null;
  return <SavedFolderActions name={node.name} folder={folder} onEdit={onEdit} />;
}
