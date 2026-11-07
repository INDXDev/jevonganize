import { t } from '../i18n/index.ts';
import { Filter, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Plan, TagCount, VocabularyEntry } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { TagColorPicker } from '../components/tag-color-picker.tsx';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { Input, Select } from '../components/ui/field.tsx';
import { formatCount } from '../lib.ts';
import { setView, useTabs, useView } from '../tabs.ts';
import { patchQuery } from '../view-query.ts';

const ALL = '__all';
const SHOWN = 500;

/** The dialog for a new tag name. `onPlan` gets the plan it makes. */
export function Rename(props: { tag: string; onClose: () => void; onPlan: (id: string) => void }) {
  const { tag, onClose, onPlan } = props;
  const [to, setTo] = useState(tag);
  const submit = async () => {
    onClose();
    const plan = await act('rename_tag', { from: tag, to: to.trim() });
    if (plan) onPlan(plan.id);
  };
  return (
    <Dialog open onClose={onClose} title={t('Rename {tag}', { tag })}>
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          aria-label={t('New tag')}
          className="font-mono"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!to.trim() || to.trim() === tag}>
          {t('Plan rename')}
        </Button>
      </form>
    </Dialog>
  );
}

function Row(props: { row: TagCount; onRename: () => void; onRemove: () => void }) {
  const { row, onRename, onRemove } = props;
  const open = useTabs((s) => s.open);
  return (
    <li className="group flex h-row items-center gap-2 px-3 hover:bg-surface-2">
      <TagColorPicker tag={row.tag} />
      <span className="min-w-0 flex-1">
        <TagChip tag={row.tag} />
      </span>
      <span className="w-14 text-right font-mono text-xs text-subtle">
        {formatCount(row.count)}
      </span>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Show files with {tag}', { tag: row.tag })}
        title={t('Show its files in a new tab')}
        onClick={() => open(patchQuery('', { tag: [row.tag] }))}
      >
        <Filter />
      </Button>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Rename {tag}', { tag: row.tag })}
        title={t('Rename or merge')}
        onClick={onRename}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={t('Remove {tag} from its files', { tag: row.tag })}
        title={t('Remove from every file')}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

const setState = ({ facet, value }: VocabularyEntry, state: 'active' | 'retired') =>
  void act('set_vocabulary', { facet, value, state });

function Vocabulary({ entries }: { entries: VocabularyEntry[] }) {
  return (
    <section>
      <h3 className="label mb-1">{t('Open vocabulary')}</h3>
      <ul className="divide-y rounded-md border">
        {entries.map((entry) => (
          <li key={`${entry.facet}:${entry.value}`} className="flex h-row items-center gap-2 px-2">
            <span className="min-w-0 flex-1">
              <TagChip tag={`${entry.facet}:${entry.value}`} />
            </span>
            <span className="font-mono text-xs text-subtle">
              {
                (
                  {
                    active: t('Active'),
                    retired: t('Retired'),
                    proposed: t('Proposed value'),
                  } as const
                )[entry.state]
              }
            </span>
            <Button
              variant="ghost"
              className="h-6"
              onClick={() => setState(entry, entry.state === 'active' ? 'retired' : 'active')}
            >
              {entry.state === 'active' ? t('Retire') : t('Activate')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TagFilters(props: {
  facets: string[];
  facet: string | null | undefined;
  text: string;
  onText: (text: string) => void;
}) {
  const { facets, facet, text, onText } = props;
  return (
    <>
      <Select
        label={t('Facet')}
        className="h-6 w-36 text-xs"
        value={facet ?? ALL}
        options={[{ value: ALL, label: t('All facets') }, ...facets.map((value) => ({ value }))]}
        onChange={(next) => setView({ facet: next === ALL ? null : next })}
      />
      <Input
        aria-label={t('Filter tags')}
        placeholder={t('Filter…')}
        className="h-6 w-44 text-sm"
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
    </>
  );
}

function TagRows(props: {
  shown: TagCount[];
  onRename: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const { shown, onRename, onRemove } = props;
  return (
    <>
      <ul className="py-1">
        {shown.slice(0, SHOWN).map((row) => (
          <Row
            key={row.tag}
            row={row}
            onRename={() => onRename(row.tag)}
            onRemove={() => onRemove(row.tag)}
          />
        ))}
      </ul>
      {shown.length > SHOWN && (
        <p className="px-3 pb-2 text-xs text-subtle">
          {t('First {shown} of {total}. Filter to narrow them.', {
            shown: SHOWN,
            total: formatCount(shown.length),
          })}
        </p>
      )}
    </>
  );
}

function TagChanges({ plan, vocabulary }: { plan?: Plan; vocabulary: VocabularyEntry[] }) {
  return (
    <div className="space-y-3 p-3">
      {plan ? (
        <Block plan={plan} />
      ) : (
        <p className="text-sm text-subtle">
          {t('Renames and removals become a plan here. Nothing changes until you apply it.')}
        </p>
      )}
      {vocabulary.length > 0 && <Vocabulary entries={vocabulary} />}
    </div>
  );
}

/** Tags across the library: `tags list`, `tags rename` and `tags remove`, plus open vocabularies. */
export function Tags() {
  const { folder, facet } = useView();
  const { data: tags = [], isLoading, error } = useTool('list_tags', { folder });
  const { data: vocabulary = [] } = useTool('list_vocabulary', {});
  const [text, setText] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [planId, setPlanId] = useState<string>();
  const { data: plan } = useTool('get_plan', { id: planId! }, { enabled: !!planId });

  const facets = [...new Set(tags.map((tagItem) => tagItem.tag.split(':')[0]!))].toSorted();
  const needle = text.trim().toLowerCase();
  const shown = tags.filter(
    (tagItem) =>
      (!facet || tagItem.tag.startsWith(`${facet}:`)) &&
      (!needle || tagItem.tag.toLowerCase().includes(needle)),
  );

  const remove = async (tag: string) => {
    const made = await act('propose_changes', {
      query: { tags: [tag], folder },
      remove: [tag],
      title: t('Remove {tag}', { tag }),
    });
    if (made) setPlanId(made.id);
  };

  return (
    <Panes id="tags" panes={['tag-list', 'tag-side']}>
      <Pane
        id="tag-list"
        minSize={380}
        loading={isLoading}
        error={error}
        empty={shown.length ? undefined : t('No tags match.')}
        title={t('Tags {count}', { count: formatCount(shown.length) })}
        actions={<TagFilters facets={facets} facet={facet} text={text} onText={setText} />}
      >
        <TagRows shown={shown} onRename={setRenaming} onRemove={(tag) => void remove(tag)} />
      </Pane>
      <Divider />
      <Pane id="tag-side" title={t('Changes')} defaultSize="36%" minSize={280}>
        <TagChanges plan={plan} vocabulary={vocabulary} />
      </Pane>
      {renaming && (
        <Rename tag={renaming} onClose={() => setRenaming(undefined)} onPlan={setPlanId} />
      )}
    </Panes>
  );
}
