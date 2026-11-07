import { t } from '../i18n/index.ts';
import { useState } from 'react';
import { act } from '../api.ts';
import { Pane, Panes } from '../components/pane.tsx';
import { Input, Select } from '../components/ui/field.tsx';
import { formatCount } from '../lib.ts';
import { useView } from '../tabs.ts';
import { AddName, NameRow } from './tags-names-list.tsx';
import { dropName, KINDS, kindLabel, useNames, type Name } from './tags-names-state.ts';
import { Rename } from './tags-rename.tsx';

/** The kind choice that shows every kind. */
const ALL_KINDS = '__all';

/** The kind choices, with "All kinds" first. Built per call, as the labels follow the language. */
const kindOptions = () => [
  { value: ALL_KINDS, label: t('All kinds') },
  ...KINDS.map((value) => ({ value, label: kindLabel(value) })),
];

/** True when `name` is of `kind`, or any kind for `ALL_KINDS`, and its tag contains `needle`. */
function matchesFilter(name: Name, kind: string, needle: string) {
  const kindMatches = kind === ALL_KINDS || name.kind === kind;
  return kindMatches && name.tag.toLowerCase().includes(needle);
}

/** The kind select and text box that narrow the list. */
function NameFilters(props: {
  kind: string;
  onKind: (kind: string) => void;
  text: string;
  onText: (text: string) => void;
}) {
  const { kind, onKind, text, onText } = props;
  return (
    <>
      <Select
        label={t('Kind')}
        className="h-6 w-32 text-xs"
        value={kind}
        options={kindOptions()}
        onChange={onKind}
      />
      <Input
        aria-label={t('Filter names')}
        placeholder={t('Filter…')}
        className="h-6 w-44 text-sm"
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
    </>
  );
}

/** Proper names, apart from other tags: what Organize found, and what a person added. */
export function Names() {
  const { folder } = useView();
  const names = useNames(folder);
  const [kind, setKind] = useState(ALL_KINDS);
  const [text, setText] = useState('');
  const [renamingTag, setRenamingTag] = useState<string>();
  const needle = text.trim().toLowerCase();
  const shown = names.filter((name) => matchesFilter(name, kind, needle));
  return (
    <Panes id="names" panes={['name-list']}>
      <Pane
        id="name-list"
        minSize={380}
        title={t('Names {count}', { count: formatCount(shown.length) })}
        actions={<NameFilters kind={kind} onKind={setKind} text={text} onText={setText} />}
      >
        <AddName />
        {shown.length > 0 ? (
          <ul className="py-1">
            {shown.map((name) => (
              <NameRow
                key={name.tag}
                name={name}
                onRename={() => setRenamingTag(name.tag)}
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
      {renamingTag && (
        <Rename
          tag={renamingTag}
          onClose={() => setRenamingTag(undefined)}
          onPlan={(id) => void act('apply_plan', { id })}
        />
      )}
    </Panes>
  );
}
