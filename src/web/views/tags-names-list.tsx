import { t } from '../i18n/index.ts';
import { Filter, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { act } from '../api.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input, Select } from '../components/ui/field.tsx';
import { formatCount } from '../lib.ts';
import { useTabs } from '../tabs.ts';
import { patchQuery } from '../view-query.ts';
import { ENTITY_FACET, KINDS, kindLabel, setNameState, type Name } from './tags-names-state.ts';

/** Registers a name a person types, under the kind they pick. */
export function AddName() {
  const [kind, setKind] = useState<string>('organization');
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = `${kind}/${name}`;
    await act('set_vocabulary', { facet: ENTITY_FACET, value, state: 'active' });
    setName('');
  };
  return (
    <form className="flex items-center gap-2 border-b p-3" onSubmit={(e) => void submit(e)}>
      <Select
        label={t('Kind')}
        className="w-36"
        value={kind}
        options={KINDS.map((value) => ({ value, label: kindLabel(value) }))}
        onChange={setKind}
      />
      <Input
        aria-label={t('Proper name')}
        placeholder={t('Proper name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" className="shrink-0" disabled={!name.trim()}>
        <Plus /> {t('Add')}
      </Button>
    </form>
  );
}

/** A small icon button in a name's row. */
function RowButton(props: {
  label: string;
  title: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const { label, title, disabled, pressed, onClick, children } = props;
  return (
    <Button
      variant="ghost"
      icon
      className="size-6"
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** One name: its kind, tag and file count, then show, register, rename and remove. */
export function NameRow(props: { name: Name; onRename: () => void; onDrop: () => void }) {
  const { name, onRename, onDrop } = props;
  const openTab = useTabs((s) => s.open);
  const { tag, kind, count, registered } = name;
  const hasFiles = count > 0;
  const PinIcon = registered ? PinOff : Pin;
  const registerLabel = registered ? t('Unregister {tag}', { tag }) : t('Register {tag}', { tag });
  const toggleRegistered = () => void setNameState(tag, registered ? 'retired' : 'active');
  return (
    <li className="flex h-row items-center gap-2 px-3 hover:bg-surface-2">
      <span className="w-24 shrink-0 truncate text-xs text-subtle">{kindLabel(kind)}</span>
      <span className="min-w-0 flex-1">
        <TagChip tag={tag} />
      </span>
      <span className="w-14 text-right font-mono text-xs text-subtle">{formatCount(count)}</span>
      <RowButton
        label={t('Show files with {tag}', { tag })}
        title={t('Show its files in a new tab')}
        disabled={!hasFiles}
        onClick={() => openTab(patchQuery('', { tag: [tag] }))}
      >
        <Filter />
      </RowButton>
      <RowButton
        label={registerLabel}
        title={t('A registered name is looked for in every file on each Organize')}
        pressed={registered}
        onClick={toggleRegistered}
      >
        <PinIcon />
      </RowButton>
      <RowButton
        label={t('Rename {tag}', { tag })}
        title={t('Rename or merge')}
        disabled={!hasFiles}
        onClick={onRename}
      >
        <Pencil />
      </RowButton>
      <RowButton
        label={t('Remove {tag} from its files', { tag })}
        title={t('Remove from every file, and stop offering it')}
        onClick={onDrop}
      >
        <Trash2 />
      </RowButton>
    </li>
  );
}
