import { t } from '../i18n/index.ts';
import { ChevronRight, FolderHeart, Pencil, Pin, Plus, X } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import type { VirtualFolder, VirtualFolderNode } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { ChipInput, Field, Input, Segmented, Select } from '../components/ui/field.tsx';
import { carriesFiles, droppedFiles } from '../file-drag.ts';
import { cn, formatCount } from '../lib.ts';
import { notify, setView, useWindow } from '../tabs.ts';
import { folderInput } from '../vfolder-query.ts';
import type { View } from '../view-query.ts';

const TOP = 'top';

/** Opens a folder in the file list, on its own: tag filters and the library folder are cleared. */
const openFolder = (node: VirtualFolderNode) =>
  setView({ vfolder: node.key, vname: node.name, folder: null, tag: [], not: [], file: null });

/** Every saved folder in the tree, depth first, with its depth. */
function flatten(nodes: VirtualFolderNode[], depth = 0): [VirtualFolderNode, number][] {
  return nodes.flatMap((node) => [[node, depth], ...flatten(node.children, depth + 1)] as const);
}

/** The plan a drop or a removal just stored, with the usual apply and discard. */
function PlanDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: plan } = useTool('get_plan', { id: id! }, { enabled: !!id });
  return (
    <Dialog open={!!id && !!plan} onClose={onClose} title={plan?.title ?? ''}>
      <div className="overflow-y-auto p-3">{plan && <Block plan={plan} />}</div>
    </Dialog>
  );
}

function useFolderPlans() {
  const [planId, setPlanId] = useState<string | null>(null);
  const put = async (folder: VirtualFolder, fileIds: number[]) => {
    if (!fileIds.length) return;
    const plan = await act('add_to_vfolder', { id: folder.id, file_ids: fileIds });
    if (plan) setPlanId(plan.id);
  };
  const take = async (folder: VirtualFolder, fileIds: number[]) => {
    if (!fileIds.length) return notify(t('Select a file first'));
    const plan = await act('remove_from_vfolder', { id: folder.id, file_ids: fileIds });
    if (plan) setPlanId(plan.id);
    return undefined;
  };
  const dialog = <PlanDialog id={planId} onClose={() => setPlanId(null)} />;
  return { put, take, dialog };
}

type Editing = { folder?: VirtualFolder; parent: number | null };

function FolderRow(props: {
  node: VirtualFolderNode;
  depth: number;
  view: View;
  onEdit?: (editing: Editing) => void;
  onDrop?: (folder: VirtualFolder, ids: number[]) => void;
}) {
  const { node, depth, view, onEdit, onDrop } = props;
  const [open, setOpen] = useState(!!node.folder);
  const [over, setOver] = useState(false);
  const folder = node.folder;
  const droppable = !!folder?.tag && !!onDrop;
  const dragOver = (e: DragEvent) => {
    if (!droppable || !carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (folder && droppable) onDrop(folder, droppedFiles(e));
  };
  const pin = () =>
    void act('save_vfolder', {
      name: node.name,
      rule: { tags: [node.key], tag_match: 'all' },
    }).then((saved) => saved && notify(t('Pinned {name}', { name: saved.name })));
  return (
    <li>
      <div
        role="presentation"
        onDragOver={dragOver}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          'group flex h-dense items-center rounded-sm text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          view.vfolder === node.key && 'bg-soft text-foreground',
          over && 'outline-2 outline-primary',
        )}
        style={{ paddingLeft: `${depth * 0.75}rem` }}
      >
        <button
          type="button"
          aria-label={
            open
              ? t('Collapse {name}', { name: node.name })
              : t('Expand {name}', { name: node.name })
          }
          aria-expanded={open}
          disabled={!node.children.length}
          onClick={() => setOpen(!open)}
          className="grid size-5 shrink-0 place-items-center text-subtle disabled:invisible"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        </button>
        <button
          type="button"
          aria-pressed={view.vfolder === node.key}
          title={
            folder?.tag ? t('Drop files here to tag them {tag}', { tag: folder.tag }) : undefined
          }
          onClick={() => openFolder(node)}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pr-1 text-left"
        >
          <span className={cn('min-w-0 flex-1 truncate', !folder && 'font-mono text-xs')}>
            {node.name}
          </span>
          <span className="font-mono text-xs text-subtle">{formatCount(node.count)}</span>
        </button>
        {folder && onEdit && (
          <span className="hidden shrink-0 group-focus-within:flex group-hover:flex">
            <button
              type="button"
              aria-label={t('New folder inside {name}', { name: node.name })}
              title={t('New folder inside {name}', { name: node.name })}
              onClick={() => onEdit({ parent: folder.id })}
              className="grid size-5 place-items-center text-subtle hover:text-foreground"
            >
              <Plus className="size-3" />
            </button>
            <button
              type="button"
              aria-label={t('Edit {name}', { name: node.name })}
              title={t('Edit {name}', { name: node.name })}
              onClick={() => onEdit({ folder, parent: folder.parent })}
              className="grid size-5 place-items-center text-subtle hover:text-foreground"
            >
              <Pencil className="size-3" />
            </button>
          </span>
        )}
        {!folder && (
          <button
            type="button"
            aria-label={t('Pin {name} as a folder', { name: node.name })}
            title={t('Pin {name} as a folder', { name: node.name })}
            onClick={pin}
            className="hidden size-5 shrink-0 place-items-center text-subtle group-focus-within:grid group-hover:grid hover:text-foreground"
          >
            <Pin className="size-3" />
          </button>
        )}
      </div>
      {open && node.children.length > 0 && (
        <FolderList
          nodes={node.children}
          depth={depth + 1}
          view={view}
          onEdit={onEdit}
          onDrop={onDrop}
        />
      )}
    </li>
  );
}

const SHOWN = 8;

function FolderList(props: {
  nodes: VirtualFolderNode[];
  depth: number;
  view: View;
  onEdit?: (editing: Editing) => void;
  onDrop?: (folder: VirtualFolder, ids: number[]) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? props.nodes : props.nodes.slice(0, SHOWN);
  return (
    <ul>
      {shown.map((node) => (
        <FolderRow key={node.key} {...props} node={node} />
      ))}
      {props.nodes.length > SHOWN && (
        <li style={{ paddingLeft: `${props.depth * 0.75 + 1.25}rem` }}>
          <button
            type="button"
            onClick={() => setAll(!all)}
            className="text-xs text-subtle hover:text-foreground"
          >
            {all ? t('Fewer') : t('{count} more', { count: props.nodes.length - SHOWN })}
          </button>
        </li>
      )}
    </ul>
  );
}

function FolderDialog(props: {
  editing: Editing | null;
  saved: VirtualFolderNode[];
  view: View;
  onClose: () => void;
}) {
  const { editing } = props;
  if (!editing) return null;
  return (
    <FolderForm key={editing.folder?.id ?? `new-${editing.parent}`} {...props} editing={editing} />
  );
}

function FolderForm(props: {
  editing: Editing;
  saved: VirtualFolderNode[];
  view: View;
  onClose: () => void;
}) {
  const { editing, saved, view, onClose } = props;
  const existing = editing.folder;
  const [name, setName] = useState(existing?.name ?? '');
  const [tags, setTags] = useState(existing?.rule.tags ?? view.tag);
  const [match, setMatch] = useState(existing?.rule.tag_match ?? view.match);
  const [exclude, setExclude] = useState(existing?.rule.exclude_tags ?? view.not);
  const [parent, setParent] = useState(editing.parent === null ? TOP : String(editing.parent));
  const [home, setHome] = useState(existing?.tag ?? '');
  const below = new Set(
    existing
      ? flatten(saved)
          .filter(([node]) => isInside(node, existing.id, saved))
          .map(([node]) => node.key)
      : [],
  );
  const parents = [
    { value: TOP, label: t('None: a top-level folder') },
    ...flatten(saved)
      .filter(([node]) => !below.has(node.key))
      .map(([node, depth]) => ({ value: node.key, label: `${'  '.repeat(depth)}${node.name}` })),
  ];
  const save = async () => {
    const done = await act('save_vfolder', {
      ...(existing && { id: existing.id }),
      name,
      parent: parent === TOP ? null : Number(parent),
      rule: {
        tags,
        tag_match: match,
        exclude_tags: exclude,
        ...(existing?.rule.folder && { folder: existing.rule.folder }),
      },
      ...(home.trim() && { tag: home.trim() }),
    });
    if (done) onClose();
  };
  const remove = async () => {
    if (!existing) return;
    await act('delete_vfolder', { id: existing.id });
    if (view.vfolder === String(existing.id) || below.has(view.vfolder ?? ''))
      setView({ vfolder: null, vname: null });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? t('Edit {name}', { name: existing.name }) : t('New folder')}
    >
      <form
        className="space-y-1 overflow-y-auto p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="pb-2 text-xs text-subtle">
          {t(
            'A virtual folder exists only here. Every file whose tags match its rule collects in it on its own. Nothing on disk moves.',
          )}
        </p>
        <Field label={t('Name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Name')} />
        </Field>
        <Field
          label={t('Tags')}
          help={t('Empty collects every file, for a folder that only groups others.')}
        >
          <ChipInput value={tags} onChange={setTags} label={t('Tags')} />
        </Field>
        <Field label={t('Match')}>
          <Segmented
            label={t('Match')}
            value={match}
            onChange={(next) => setMatch(next === 'all' ? 'all' : 'any')}
            options={[
              { value: 'any', label: t('Any of these tags') },
              { value: 'all', label: t('All of these tags') },
            ]}
          />
        </Field>
        <Field label={t('Without')}>
          <ChipInput value={exclude} onChange={setExclude} label={t('Without')} />
        </Field>
        <Field
          label={t('Inside')}
          help={t('A folder inside another shows only files that match both.')}
        >
          <Select label={t('Inside')} value={parent} onChange={setParent} options={parents} />
        </Field>
        <Field
          label={t('Home tag')}
          help={t(
            'What a file dropped in gets. Left empty, the rule’s tag when it has exactly one.',
          )}
        >
          <Input
            value={home}
            onChange={(e) => setHome(e.target.value)}
            aria-label={t('Home tag')}
            className="font-mono text-xs"
            placeholder={tags.length === 1 ? tags[0] : t('Dropping is off')}
          />
        </Field>
        <div className="flex justify-between pt-2">
          {existing ? (
            <Button variant="danger" onClick={() => void remove()}>
              {t('Delete folder')}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-1.5">
            <Button variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" type="submit" disabled={!name.trim()}>
              {t('Save')}
            </Button>
          </span>
        </div>
      </form>
    </Dialog>
  );
}

/** True when `node` is the folder `id` or lies under it. */
function isInside(node: VirtualFolderNode, id: number, saved: VirtualFolderNode[]): boolean {
  const byKey = new Map(flatten(saved).map(([entry]) => [entry.key, entry]));
  for (let at: VirtualFolderNode | undefined = node; at?.folder;) {
    if (at.folder.id === id) return true;
    at = at.folder.parent === null ? undefined : byKey.get(String(at.folder.parent));
  }
  return false;
}

/** The sidebar's virtual folders: the saved tree, then the generated one on demand. */
export function FoldersSection({ view }: { view: View }) {
  const { data } = useTool('list_vfolders', {});
  const [auto, setAuto] = useState(false);
  const { data: generated } = useTool('list_vfolders', { generated: true }, { enabled: auto });
  const [editing, setEditing] = useState<Editing | null>(null);
  const plans = useFolderPlans();
  const saved = data?.saved ?? [];
  return (
    <section data-tour="vfolders" aria-label={t('Folders')} className="px-1.5 pb-3">
      <div className="flex items-center justify-between px-2 pb-1">
        <h3 className="label">{t('Folders')}</h3>
        <button
          type="button"
          aria-label={t('New folder')}
          title={t('New folder')}
          onClick={() => setEditing({ parent: null })}
          className="grid size-5 place-items-center text-subtle hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {saved.length ? (
        <FolderList
          nodes={saved}
          depth={0}
          view={view}
          onEdit={setEditing}
          onDrop={(folder, ids) => void plans.put(folder, ids)}
        />
      ) : (
        <p className="px-2 text-xs text-subtle">
          {t('No folders yet. A folder collects every file whose tags match its rule.')}
        </p>
      )}
      <button
        type="button"
        aria-expanded={auto}
        onClick={() => setAuto(!auto)}
        className="mt-1 flex h-dense w-full items-center gap-1 px-1 text-xs text-subtle hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', auto && 'rotate-90')} />
        {t('Auto: one folder per tag')}
      </button>
      {auto && <FolderList nodes={generated?.generated ?? []} depth={0} view={view} />}
      <FolderDialog editing={editing} saved={saved} view={view} onClose={() => setEditing(null)} />
      {plans.dialog}
    </section>
  );
}

/** The strip above the file list while a virtual folder is open. */
export function FolderBar({ view }: { view: View }) {
  const key = view.vfolder!;
  const { data: files } = useTool('vfolder_files', folderInput(key));
  const { data: tree } = useTool('list_vfolders', {});
  const node = flatten(tree?.saved ?? []).find(([entry]) => entry.key === key)?.[0];
  const folder = node?.folder;
  const selection = useWindow((s) => s.selection);
  const plans = useFolderPlans();
  const picked = selection.ids.size ? [...selection.ids] : view.file ? [view.file] : [];
  const rule = folder
    ? [
        folder.rule.tags.join(folder.rule.tag_match === 'any' ? ' | ' : ' & '),
        ...folder.rule.exclude_tags.map((tag) => `−${tag}`),
      ]
        .filter(Boolean)
        .join('  ')
    : key;
  return (
    <div className="flex items-center gap-2 border-b bg-surface-1 px-3 py-1.5 text-sm">
      <FolderHeart aria-hidden className="size-3.5 shrink-0 text-subtle" />
      <span className="min-w-0 truncate font-medium">{view.vname ?? key}</span>
      <span className="min-w-0 truncate font-mono text-xs text-subtle">{rule}</span>
      <span className="font-mono text-xs text-subtle">{formatCount(files?.total ?? 0)}</span>
      <span className="flex-1" />
      {folder?.tag && (
        <Button variant="ghost" className="h-6" onClick={() => void plans.take(folder, picked)}>
          {t('Remove from folder')}
        </Button>
      )}
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Close the folder')}
        title={t('Close the folder')}
        onClick={() => setView({ vfolder: null, vname: null })}
      >
        <X />
      </Button>
      {plans.dialog}
    </div>
  );
}
