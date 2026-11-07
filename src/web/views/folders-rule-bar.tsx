import { t } from '../i18n/index.ts';
import { Pencil, Plus, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { FolderRule, VirtualFolder } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { formatCount } from '../lib.ts';
import { setView, useWindow } from '../tabs.ts';
import { folderInput } from '../vfolder-query.ts';
import type { View } from '../view-query.ts';
import { useFolderPlans } from './folders-plans.tsx';
import { TagSearch } from './folders-tag-combobox.tsx';
import { flattenTree } from './folders-tree-list.tsx';
import type { Editing } from './folders-tree-row.tsx';

/** The files a removal applies to: the selection, or else the file open in the inspector. */
function useTargetFiles(view: View): number[] {
  const selection = useWindow((s) => s.selection);
  if (selection.ids.size) return [...selection.ids];
  return view.file ? [view.file] : [];
}

/** The saved folder behind `folderKey`, or none for a generated folder. */
function useSavedFolder(folderKey: string): VirtualFolder | null | undefined {
  const { data: folderTree } = useTool('list_vfolders', {});
  const entry = flattenTree(folderTree?.saved ?? []).find(({ node }) => node.key === folderKey);
  return entry?.node.folder;
}

/**
 * Saves `folder` with a changed rule. A home tag that only came from the rule's single tag is left
 * out, so the server works it out again from the new rule.
 */
function saveRule(folder: VirtualFolder, change: Partial<FolderRule>) {
  const { rule } = folder;
  const isDerivedHome = rule.tags.length === 1 && folder.tag === rule.tags[0];
  return act('save_vfolder', {
    id: folder.id,
    name: folder.name,
    parent: folder.parent,
    rule: { ...rule, ...change },
    ...(!isDerivedHome && { tag: folder.tag }),
  });
}

const without = (list: string[], tag: string) => list.filter((entry) => entry !== tag);

/** `+`, which turns into a tag search until a tag is picked or the field loses focus. */
function AddTag({ folder }: { folder: VirtualFolder }) {
  const [isAdding, setIsAdding] = useState(false);
  const { tags } = folder.rule;
  if (!isAdding)
    return (
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Add a tag to the rule')}
        title={t('Add a tag to the rule')}
        onClick={() => setIsAdding(true)}
      >
        <Plus />
      </Button>
    );
  return (
    <span onBlur={() => setIsAdding(false)} className="flex w-48">
      <TagSearch
        focusOnMount
        label={t('Add a tag to the rule')}
        taken={tags}
        onPick={(tag) => {
          setIsAdding(false);
          void saveRule(folder, { tags: [...tags, tag] });
        }}
      />
    </span>
  );
}

/** A saved folder's rule as chips: × takes a tag out and `+` adds one, saving at once. */
function RuleChips({ folder }: { folder: VirtualFolder }) {
  const { tags, tag_match, exclude_tags } = folder.rule;
  const joiner = tag_match === 'all' ? t('and') : t('or');
  return (
    <>
      {tags.map((tag, i) => (
        <Fragment key={tag}>
          {i > 0 && <span className="px-0.5 font-mono text-xs text-subtle">{joiner}</span>}
          <TagChip tag={tag} onRemove={() => void saveRule(folder, { tags: without(tags, tag) })} />
        </Fragment>
      ))}
      <AddTag folder={folder} />
      {exclude_tags.map((tag) => (
        <TagChip
          key={tag}
          tag={tag}
          negated
          onRemove={() => void saveRule(folder, { exclude_tags: without(exclude_tags, tag) })}
        />
      ))}
    </>
  );
}

/** Edit, which opens the full editor, and close. */
function BarButton(props: { label: string; icon: typeof X; onClick: () => void }) {
  const { label, icon: Icon, onClick } = props;
  return (
    <Button
      variant="ghost"
      icon
      className="size-6"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}

const closeFolder = () => setView({ vfolder: null, vname: null });

/**
 * The strip above the list of an open folder: its rule, editable in place for a saved folder, and
 * its file count. A generated folder shows its tag, read only.
 */
export function RuleBar({ view, onEdit }: { view: View; onEdit: (editing: Editing) => void }) {
  // Folders renders this bar only while a folder is open.
  const folderKey = view.vfolder!;
  const { data: folderFiles } = useTool('vfolder_files', folderInput(folderKey));
  const folder = useSavedFolder(folderKey);
  const targetFiles = useTargetFiles(view);
  const folderPlans = useFolderPlans();
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-surface-1 px-3 py-1.5 text-sm">
      {folder ? <RuleChips folder={folder} /> : <TagChip tag={folderKey} />}
      <output className="ml-2 font-mono text-xs text-subtle">
        {t('{count} files', { count: formatCount(folderFiles?.total ?? 0) })}
      </output>
      <span className="flex-1" />
      {folder?.tag && (
        <Button
          variant="ghost"
          className="h-6"
          onClick={() => void folderPlans.removeFiles(folder, targetFiles)}
        >
          {t('Remove from folder')}
        </Button>
      )}
      {folder && (
        <BarButton
          label={t('Edit {name}', { name: folder.name })}
          icon={Pencil}
          onClick={() => onEdit({ folder, parent: folder.parent })}
        />
      )}
      <BarButton label={t('Close the folder')} icon={X} onClick={closeFolder} />
      {folderPlans.dialog}
    </div>
  );
}
