import { t } from '../i18n/index.ts';
import { Plus, Trash2 } from 'lucide-react';
import type { Facet, FacetKind } from '../../types.ts';
import { useTool } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { ChipInput, Field, Input, Select, Switch, Textarea } from '../components/ui/field.tsx';

const KIND_LABELS = {
  flag: 'Flag',
  choice: 'Choice',
  multi: 'Multiple choices',
  level: 'Level',
  date: 'Date',
  field: 'Metadata field',
} as const;

const KINDS: FacetKind[] = ['flag', 'choice', 'multi', 'level', 'date', 'field'];

type Editing = { draft: Facet; set: (patch: Partial<Facet>) => void };

/** Label and definition pairs, for `values` and `aliases`. */
function Pairs(props: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  name: string;
}) {
  const { value, onChange, name } = props;
  const entries = Object.entries(value);
  const set = (list: [string, string][]) => onChange(Object.fromEntries(list));
  return (
    <div className="space-y-1">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <Input
            aria-label={t('{name} {index} key', { name, index: i + 1 })}
            className="w-32 shrink-0 font-mono text-xs"
            value={k}
            onChange={(e) => set(entries.with(i, [e.target.value, v]))}
          />
          <Input
            aria-label={t('{name} {index} text', { name, index: i + 1 })}
            value={v}
            onChange={(e) => set(entries.with(i, [k, e.target.value]))}
          />
          <Button
            variant="ghost"
            icon
            aria-label={t('Remove {tag}', { tag: k })}
            onClick={() => set(entries.toSpliced(i, 1))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => set([...entries, [`new-${entries.length + 1}`, '']])}>
        <Plus /> {t('Add')}
      </Button>
    </div>
  );
}

function IdentityFields({ draft, set }: Editing) {
  return (
    <>
      <Field label={t('Id')} help={t('Tags are written as id:label.')}>
        <Input
          className="font-mono"
          value={draft.id}
          onChange={(e) => set({ id: e.target.value })}
        />
      </Field>
      <Field label={t('Title')}>
        <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label={t('Pack')}>
        <Input
          className="font-mono"
          value={draft.pack}
          onChange={(e) => set({ pack: e.target.value })}
        />
      </Field>
      <Field label={t('Kind')}>
        <Select
          label={t('Kind')}
          className="w-40"
          value={draft.kind}
          options={KINDS.map((value) => ({ value, label: t(KIND_LABELS[value]) }))}
          onChange={(k) => set({ kind: k as FacetKind })}
        />
      </Field>
    </>
  );
}

function QuestionField({ draft, set }: Editing) {
  return (
    <Field label={t('Question')}>
      <Textarea
        rows={2}
        value={draft.instructions ?? ''}
        onChange={(e) => set({ instructions: e.target.value })}
      />
    </Field>
  );
}

function ValueFields({ draft, set }: Editing) {
  return (
    <>
      <Field label={t('Values')} help={t('The definition is the prompt.')}>
        <Pairs
          name={t('Value')}
          value={draft.values ?? {}}
          onChange={(values) => set({ values })}
        />
      </Field>
      <Field label={t('Open vocabulary')} help={t('Accepted suggestions become new values.')}>
        <Switch checked={!!draft.open} onCheckedChange={(open) => set({ open })} />
      </Field>
    </>
  );
}

function LevelsField({ draft, set }: Editing) {
  return (
    <Field label={t('Levels')} help={t('Lowest first.')}>
      <ChipInput
        label={t('Levels')}
        value={draft.levels ?? []}
        onChange={(levels) => set({ levels })}
      />
    </Field>
  );
}

function AliasesField({ draft, set }: Editing) {
  return (
    <Field label={t('Aliases')} help={t('Old label to current label. Costs no model call.')}>
      <Pairs
        name={t('Alias')}
        value={draft.aliases ?? {}}
        onChange={(aliases) => set({ aliases })}
      />
    </Field>
  );
}

function PrecisionField({ draft, set }: Editing) {
  return (
    <Field label={t('Precision')}>
      <Select
        label={t('Precision')}
        className="w-40"
        value={draft.precision ?? 'year'}
        options={[
          { value: 'year', label: t('Year') },
          { value: 'month', label: t('Month') },
        ]}
        onChange={(p) => set({ precision: p as Facet['precision'] })}
      />
    </Field>
  );
}

function MetadataFields({ draft, set }: Editing) {
  return (
    <>
      <Field label={t('Metadata key')} help={t('Such as author.')}>
        <Input
          className="font-mono"
          value={draft.field ?? ''}
          onChange={(e) => set({ field: e.target.value })}
        />
      </Field>
      <Field label={t('Format')}>
        <Select
          label={t('Format')}
          className="w-40"
          value={draft.format ?? 'none'}
          options={[
            { value: 'none', label: t('None') },
            { value: 'year', label: t('Year') },
            { value: 'month', label: t('Month') },
            { value: 'fiscal-year', label: t('Fiscal year') },
          ]}
          onChange={(f) => set({ format: f === 'none' ? undefined : (f as Facet['format']) })}
        />
      </Field>
    </>
  );
}

function NumberField(
  props: Editing & { name: 'apply_above' | 'weight'; label: string; help: string },
) {
  const { draft, set, name, label, help } = props;
  return (
    <Field label={label} help={help}>
      <Input
        type="number"
        step={0.05}
        min={0}
        max={name === 'apply_above' ? 1 : undefined}
        className="w-24 font-mono"
        value={draft[name] ?? ''}
        onChange={(e) => {
          const value = e.target.value === '' ? undefined : Number(e.target.value);
          set({ [name]: value });
        }}
      />
    </Field>
  );
}

function ProfileField({ draft, set, profiles }: Editing & { profiles: string[] }) {
  return (
    <Field label={t('Profile')} help={t('A named model from config. Empty uses the default.')}>
      <Select
        label={t('Profile')}
        className="w-40"
        value={draft.profile ?? 'default'}
        options={[
          { value: 'default', label: t('Default') },
          ...profiles.map((value) => ({ value })),
        ]}
        onChange={(p) => set({ profile: p === 'default' ? undefined : p })}
      />
    </Field>
  );
}

/** The facet editor. Each kind shows only the fields that mean something for it. */
export function Form({ draft, set }: Editing) {
  const { kind } = draft;
  const asks = kind !== 'field';
  const hasValues = kind === 'choice' || kind === 'multi';
  const hasLabels = hasValues || kind === 'level';
  const editing = { draft, set };
  const { data: config } = useTool('get_config', {});
  const profiles = Object.keys((config?.config.profiles as object | undefined) ?? {});
  return (
    <div className="max-w-2xl p-4">
      <IdentityFields {...editing} />
      {asks && <QuestionField {...editing} />}
      {hasValues && <ValueFields {...editing} />}
      {kind === 'level' && <LevelsField {...editing} />}
      {hasLabels && <AliasesField {...editing} />}
      {kind === 'date' && <PrecisionField {...editing} />}
      {kind === 'field' && <MetadataFields {...editing} />}
      <Field label={t('Applies to')} help={t('MIME globs. Empty means every file.')}>
        <ChipInput
          label={t('Applies to')}
          value={draft.applies_to}
          onChange={(applies_to) => set({ applies_to })}
        />
      </Field>
      <NumberField
        {...editing}
        name="weight"
        label={t('Weight')}
        help={t('In similarity. 0 leaves this facet out.')}
      />
      {asks && (
        <NumberField
          {...editing}
          name="apply_above"
          label={t('Apply above')}
          help={t('Overrides thresholds.apply.')}
        />
      )}
      {asks && <ProfileField {...editing} profiles={profiles} />}
    </div>
  );
}
