import { t } from '../i18n/index.ts';
import type { VirtualFolder, VirtualFolderNode } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Dialog } from '../components/ui/dialog.tsx';
import { setView, useView } from '../tabs.ts';
import {
  FolderFields,
  FormButtons,
  TOP_LEVEL,
  useFolderDraft,
  type FolderDraft,
} from './folders-dialog-fields.tsx';
import { LiveCount, useRuleHints } from './folders-rule-hints.tsx';
import { flattenTree } from './folders-tree-list.tsx';
import { openSavedFolder, type Editing } from './folders-tree-row.tsx';

/** True when `node` is the folder `ancestorId` or lies anywhere under it, by its parent links. */
function isSelfOrDescendant(
  node: VirtualFolderNode,
  ancestorId: number,
  saved: VirtualFolderNode[],
): boolean {
  const nodeByKey = new Map(flattenTree(saved).map((entry) => [entry.node.key, entry.node]));
  let current: VirtualFolderNode | undefined = node;
  while (current?.folder) {
    if (current.folder.id === ancestorId) return true;
    const parentId: number | null = current.folder.parent;
    current = parentId === null ? undefined : nodeByKey.get(String(parentId));
  }
  return false;
}

/** The keys of `folder` and of every folder under it, none of which can become its parent. */
function selfAndDescendants(folder: VirtualFolder | undefined, saved: VirtualFolderNode[]) {
  if (!folder) return new Set<string>();
  const subtree = flattenTree(saved).filter(({ node }) =>
    isSelfOrDescendant(node, folder.id, saved),
  );
  return new Set(subtree.map(({ node }) => node.key));
}

/** The folders a folder can sit in, indented by depth, after the top level. */
function parentOptions(saved: VirtualFolderNode[], excluded: Set<string>) {
  const candidates = flattenTree(saved).filter(({ node }) => !excluded.has(node.key));
  return [
    { value: TOP_LEVEL, label: t('None: a top-level folder') },
    ...candidates.map(({ node, depth }) => ({
      value: node.key,
      label: `${'  '.repeat(depth)}${node.name}`,
    })),
  ];
}

/** Saves the draft as `existing`, or as a new folder. Returns the saved folder, if it was. */
async function saveFolder(draft: FolderDraft, existing: VirtualFolder | undefined) {
  const homeTag = draft.homeTag.trim();
  return act('save_vfolder', {
    ...(existing && { id: existing.id }),
    name: draft.name.trim(),
    parent: draft.parent === TOP_LEVEL ? null : Number(draft.parent),
    rule: draft.rule,
    ...(homeTag && { tag: homeTag }),
  });
}

type FolderFormProps = { editing: Editing; onClose: () => void };

/**
 * The folder editor: name, rule, parent and home tag, with save, cancel and delete. The index
 * counts the rule's files and suggests tags as it changes. A new folder opens once saved.
 */
function FolderForm({ editing, onClose }: FolderFormProps) {
  const existing = editing.folder;
  const view = useView();
  const { data: folderTree } = useTool('list_vfolders', {});
  const saved = folderTree?.saved ?? [];
  const { draft, set } = useFolderDraft(editing);
  const hints = useRuleHints(draft.rule);
  const subtreeKeys = selfAndDescendants(existing, saved);
  const submit = async () => {
    const folder = await saveFolder(draft, existing);
    if (!folder) return;
    if (!existing) openSavedFolder(folder);
    onClose();
  };
  const deleteFolder = async () => {
    if (!existing) return;
    await act('delete_vfolder', { id: existing.id });
    const deletedOpenFolder =
      view.vfolder === String(existing.id) || subtreeKeys.has(view.vfolder ?? '');
    if (deletedOpenFolder) setView({ vfolder: null, vname: null });
    onClose();
  };
  const title = existing ? t('Edit {name}', { name: existing.name }) : t('New folder');
  return (
    <Dialog open onClose={onClose} title={title}>
      <form
        className="space-y-1 overflow-y-auto p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-start gap-3 pb-2">
          <p className="flex-1 text-xs text-subtle">
            {t(
              'A virtual folder exists only here. Every file whose tags match its rule collects in it on its own. Nothing on disk moves.',
            )}
          </p>
          <LiveCount hints={hints} />
        </div>
        <FolderFields
          draft={draft}
          set={set}
          hints={hints}
          parents={parentOptions(saved, subtreeKeys)}
        />
        <FormButtons
          canDelete={!!existing}
          canSave={!!draft.name.trim()}
          hints={hints}
          onDelete={() => void deleteFolder()}
          onCancel={onClose}
        />
      </form>
    </Dialog>
  );
}

/** The dialog that creates or edits a saved folder, shown while `editing` is set. */
export function FolderDialog(props: { editing: Editing | null; onClose: () => void }) {
  const { editing, onClose } = props;
  if (!editing) return null;
  // A new key per folder, so switching folders starts a fresh form.
  const formKey = editing.folder?.id ?? `new-${editing.parent}`;
  return <FolderForm key={formKey} editing={editing} onClose={onClose} />;
}
