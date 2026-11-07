import { t } from '../i18n/index.ts';
import { Filter, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import type { Tag } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Pane, Panes } from '../components/pane.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input, Select } from '../components/ui/field.tsx';
import { formatCount } from '../lib.ts';
import { useTabs, useView } from '../tabs.ts';
import { patchQuery } from '../view-query.ts';
import { Rename } from './tags.tsx';

const FACET = 'entity';
const ALL = '__all';
const KINDS = ['person', 'organization', 'place', 'product', 'project', 'event'] as const;

const kindLabel = (kind: string) =>
  ({
    person: t('Person'),
    organization: t('Organization'),
    place: t('Place'),
    product: t('Product'),
    project: t('Project'),
    event: t('Event'),
  })[kind] ?? kind;

type Name = { tag: Tag; kind: string; count: number; registered: boolean };

const valueOf = (tag: Tag) => tag.slice(FACET.length + 1);
const setState = (tag: Tag, state: 'active' | 'retired') =>
  act('set_vocabulary', { facet: FACET, value: valueOf(tag), state });

/** Takes a name off its files and keeps the model from offering it again. Undo restores the tags. */
async function dropName(tag: Tag, folder?: string) {
  const title = t('Remove {tag}', { tag });
  const plan = await act('propose_changes', {
    query: { tags: [tag], folder },
    remove: [tag],
    title,
  });
  if (plan) await act('apply_plan', { id: plan.id });
  await setState(tag, 'retired');
}

/** Names on files and names a person registered, as one list. Retired ones are gone from both. */
function useNames(folder?: string): Name[] {
  const { data: tags = [] } = useTool('list_tags', { folder, facet: FACET });
  const { data: entries = [] } = useTool('list_vocabulary', { facet: FACET });
  return useMemo(() => {
    const registered = new Set(
      entries.filter((e) => e.state === 'active').map((e) => `${FACET}:${e.value}`),
    );
    const counts = new Map(tags.map(({ tag, count }) => [tag, count]));
    return [...new Set([...registered, ...counts.keys()])]
      .map((tag) => ({
        tag,
        kind: valueOf(tag).split('/')[0]!,
        count: counts.get(tag) ?? 0,
        registered: registered.has(tag),
      }))
      .toSorted((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [tags, entries]);
}

function AddName() {
  const [kind, setKind] = useState<string>('organization');
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await act('set_vocabulary', { facet: FACET, value: `${kind}/${name}`, state: 'active' });
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

function NameRow(props: { name: Name; onRename: () => void; onDrop: () => void }) {
  const { name, onRename, onDrop } = props;
  const open = useTabs((s) => s.open);
  const { tag, kind, count, registered } = name;
  const PinIcon = registered ? PinOff : Pin;
  return (
    <li className="flex h-row items-center gap-2 px-3 hover:bg-surface-2">
      <span className="w-24 shrink-0 truncate text-xs text-subtle">{kindLabel(kind)}</span>
      <span className="min-w-0 flex-1">
        <TagChip tag={tag} />
      </span>
      <span className="w-14 text-right font-mono text-xs text-subtle">{formatCount(count)}</span>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Show files with {tag}', { tag })}
        title={t('Show its files in a new tab')}
        disabled={count === 0}
        onClick={() => open(patchQuery('', { tag: [tag] }))}
      >
        <Filter />
      </Button>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={registered ? t('Unregister {tag}', { tag }) : t('Register {tag}', { tag })}
        title={t('A registered name is looked for in every file on each Organize')}
        aria-pressed={registered}
        onClick={() => void setState(tag, registered ? 'retired' : 'active')}
      >
        <PinIcon />
      </Button>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Rename {tag}', { tag })}
        title={t('Rename or merge')}
        disabled={count === 0}
        onClick={onRename}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Remove {tag} from its files', { tag })}
        title={t('Remove from every file, and stop offering it')}
        onClick={onDrop}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/** Proper names, apart from other tags: what Organize found, and what a person added. */
export function Names() {
  const { folder } = useView();
  const names = useNames(folder);
  const [kind, setKind] = useState(ALL);
  const [text, setText] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const needle = text.trim().toLowerCase();
  const shown = names.filter(
    (name) => (kind === ALL || name.kind === kind) && name.tag.toLowerCase().includes(needle),
  );
  const filters = (
    <>
      <Select
        label={t('Kind')}
        className="h-6 w-32 text-xs"
        value={kind}
        options={[
          { value: ALL, label: t('All kinds') },
          ...KINDS.map((value) => ({ value, label: kindLabel(value) })),
        ]}
        onChange={setKind}
      />
      <Input
        aria-label={t('Filter names')}
        placeholder={t('Filter…')}
        className="h-6 w-44 text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </>
  );
  return (
    <Panes id="names" panes={['name-list']}>
      <Pane
        id="name-list"
        minSize={380}
        title={t('Names {count}', { count: formatCount(shown.length) })}
        actions={filters}
      >
        <AddName />
        {shown.length > 0 ? (
          <ul className="py-1">
            {shown.map((name) => (
              <NameRow
                key={name.tag}
                name={name}
                onRename={() => setRenaming(name.tag)}
                onDrop={() => void dropName(name.tag, folder)}
              />
            ))}
          </ul>
        ) : (
          <p className="p-3 text-sm text-subtle">
            {t('Organize reads proper names from your files. They appear here.')}
          </p>
        )}
      </Pane>
      {renaming && (
        <Rename
          tag={renaming}
          onClose={() => setRenaming(undefined)}
          onPlan={(id) => void act('apply_plan', { id })}
        />
      )}
    </Panes>
  );
}
