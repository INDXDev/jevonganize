import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Facet, FacetInfo, FacetKind, Job } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import {
  Checkbox,
  ChipInput,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from '../components/ui/field.tsx';
import { cn, keyLabel, useReset } from '../lib.ts';
import { activeTab, notify, setView, useActions, useView } from '../tabs.ts';
import { parseView } from '../view-query.ts';

const KINDS: FacetKind[] = ['flag', 'choice', 'multi', 'level', 'date', 'field'];
const blank: Facet = {
  id: '',
  pack: 'custom',
  title: '',
  kind: 'choice',
  applies_to: [],
  weight: 1,
  values: {},
};
const plain = ({ enabled: _e, custom: _c, ...facet }: FacetInfo): Facet => facet;

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
            aria-label={`${name} ${i + 1} key`}
            className="w-32 shrink-0 font-mono text-xs"
            value={k}
            onChange={(e) => set(entries.with(i, [e.target.value, v]))}
          />
          <Input
            aria-label={`${name} ${i + 1} text`}
            value={v}
            onChange={(e) => set(entries.with(i, [k, e.target.value]))}
          />
          <Button
            variant="ghost"
            icon
            aria-label={`Remove ${k}`}
            onClick={() => set(entries.toSpliced(i, 1))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => set([...entries, [`new-${entries.length + 1}`, '']])}>
        <Plus /> Add
      </Button>
    </div>
  );
}

function Form({ draft, set }: { draft: Facet; set: (patch: Partial<Facet>) => void }) {
  const { kind } = draft;
  const asks = kind !== 'field';
  const { data: config } = useTool('get_config', {});
  const profiles = Object.keys((config?.config.profiles as object | undefined) ?? {});
  const instructions = asks && (
    <Field label="Question">
      <Textarea
        rows={2}
        value={draft.instructions ?? ''}
        onChange={(e) => set({ instructions: e.target.value })}
      />
    </Field>
  );
  const number = (key: 'apply_above' | 'weight', label: string, help: string) => (
    <Field label={label} help={help}>
      <Input
        type="number"
        step={0.05}
        min={0}
        max={key === 'apply_above' ? 1 : undefined}
        className="w-24 font-mono"
        value={draft[key] ?? ''}
        onChange={(e) => {
          const value = e.target.value === '' ? undefined : Number(e.target.value);
          set({ [key]: value });
        }}
      />
    </Field>
  );
  return (
    <div className="max-w-2xl p-4">
      <Field label="Id" help="Tags are written as id:label.">
        <Input
          className="font-mono"
          value={draft.id}
          onChange={(e) => set({ id: e.target.value })}
        />
      </Field>
      <Field label="Title">
        <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Pack">
        <Input
          className="font-mono"
          value={draft.pack}
          onChange={(e) => set({ pack: e.target.value })}
        />
      </Field>
      <Field label="Kind">
        <Select
          label="Kind"
          className="w-40"
          value={kind}
          options={KINDS.map((value) => ({ value }))}
          onChange={(k) => set({ kind: k as FacetKind })}
        />
      </Field>
      {instructions}
      {(kind === 'choice' || kind === 'multi') && (
        <>
          <Field label="Values" help="The definition is the prompt.">
            <Pairs name="Value" value={draft.values ?? {}} onChange={(values) => set({ values })} />
          </Field>
          <Field label="Open vocabulary" help="Accepted suggestions become new values.">
            <Switch checked={!!draft.open} onCheckedChange={(open) => set({ open })} />
          </Field>
        </>
      )}
      {kind === 'level' && (
        <Field label="Levels" help="Lowest first.">
          <ChipInput
            label="Levels"
            value={draft.levels ?? []}
            onChange={(levels) => set({ levels })}
          />
        </Field>
      )}
      {(kind === 'choice' || kind === 'multi' || kind === 'level') && (
        <Field label="Aliases" help="Old label to current label. Costs no model call.">
          <Pairs
            name="Alias"
            value={draft.aliases ?? {}}
            onChange={(aliases) => set({ aliases })}
          />
        </Field>
      )}
      {kind === 'date' && (
        <Field label="Precision">
          <Select
            label="Precision"
            className="w-40"
            value={draft.precision ?? 'year'}
            options={[{ value: 'year' }, { value: 'month' }]}
            onChange={(p) => set({ precision: p as Facet['precision'] })}
          />
        </Field>
      )}
      {kind === 'field' && (
        <>
          <Field label="Metadata key" help="Such as author.">
            <Input
              className="font-mono"
              value={draft.field ?? ''}
              onChange={(e) => set({ field: e.target.value })}
            />
          </Field>
          <Field label="Format">
            <Select
              label="Format"
              className="w-40"
              value={draft.format ?? 'none'}
              options={[
                { value: 'none' },
                { value: 'year' },
                { value: 'month' },
                { value: 'fiscal-year' },
              ]}
              onChange={(f) => set({ format: f === 'none' ? undefined : (f as Facet['format']) })}
            />
          </Field>
        </>
      )}
      <Field label="Applies to" help="MIME globs. Empty means every file.">
        <ChipInput
          label="Applies to"
          value={draft.applies_to}
          onChange={(applies_to) => set({ applies_to })}
        />
      </Field>
      {number('weight', 'Weight', 'In similarity. 0 leaves this facet out.')}
      {asks && number('apply_above', 'Apply above', 'Overrides thresholds.apply.')}
      {asks && (
        <Field label="Profile" help="A named model from config. Empty uses the default.">
          <Select
            label="Profile"
            className="w-40"
            value={draft.profile ?? 'default'}
            options={[{ value: 'default' }, ...profiles.map((value) => ({ value }))]}
            onChange={(p) => set({ profile: p === 'default' ? undefined : p })}
          />
        </Field>
      )}
    </div>
  );
}

function Sample({ draft, save }: { draft: Facet; save: () => Promise<boolean> }) {
  const folder = parseView(activeTab().query).folder;
  const query = { folder, limit: 20 };
  const facets = [draft.id];
  const { data: estimate } = useTool('estimate', { query, facets }, { enabled: !!draft.id });
  const { data: status } = useTool('status', {});
  const [jobId, setJobId] = useState<string>();
  const job: Job | undefined = status?.jobs.find((j) => j.id === jobId);
  const { data: plan } = useTool(
    'get_plan',
    { id: job?.plan_id ?? '' },
    { enabled: !!job?.plan_id },
  );

  useReset(draft.id, () => setJobId(undefined));

  const run = async () => {
    if (!(await save())) return;
    const started = await act('organize', { query, facets });
    setJobId(started?.id);
  };
  return (
    <Pane
      id="sample"
      title="Sample on 20 files"
      defaultSize="26%"
      minSize={240}
      className="space-y-3 p-3"
    >
      <p className="font-mono text-xs text-muted-foreground">
        {estimate
          ? `${estimate.files} files · ${estimate.cost_usd === null ? 'cost unknown' : `about $${estimate.cost_usd.toFixed(2)}`}`
          : 'Save an id to estimate.'}
      </p>
      <p className="text-xs text-subtle">
        Saves, then asks the model about 20 files in the current folder. It spends money and stores
        a plan like any other run. Nothing is written until you apply it.
      </p>
      <Button disabled={!draft.id} onClick={() => void run()}>
        Run on sample
      </Button>
      {job && <Block job={job} />}
      {plan && <Block plan={plan} />}
    </Pane>
  );
}

function Packs(props: { facets: FacetInfo[]; current?: string; actions: ReactNode }) {
  const { facets, current, actions } = props;
  const packs = useMemo(() => [...Map.groupBy(facets, (f) => f.pack)], [facets]);
  return (
    <Pane
      id="packs"
      title="Facets"
      actions={actions}
      defaultSize="22%"
      minSize={200}
      className="p-1.5"
    >
      {packs.map(([pack, list]) => (
        <section key={pack} className="pb-2">
          <label className="flex h-row items-center gap-2 px-1.5 text-sm font-medium">
            <Checkbox
              aria-label={`Pack ${pack}`}
              checked={list.some((f) => f.enabled)}
              onCheckedChange={(on) =>
                void act('set_enabled', { ids: [pack], enabled: on === true })
              }
            />
            <span className="capitalize">{pack}</span>
            <span className="ml-auto font-mono text-xs text-subtle">{list.length}</span>
          </label>
          {list.map((f) => (
            <div
              key={f.id}
              className={cn(
                'flex h-dense items-center gap-2 rounded-sm pr-1.5 pl-6 hover:bg-surface-2',
                f.id === current && 'bg-soft',
              )}
            >
              <Checkbox
                aria-label={`Facet ${f.id}`}
                checked={f.enabled}
                onCheckedChange={(on) =>
                  void act('set_enabled', { ids: [f.id], enabled: on === true })
                }
              />
              <button
                type="button"
                aria-current={f.id === current}
                onClick={() => setView({ facet: f.id })}
                className="min-w-0 flex-1 truncate text-left font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                {f.id}
              </button>
              {f.custom && <span className="text-2xs text-subtle">custom</span>}
            </div>
          ))}
        </section>
      ))}
    </Pane>
  );
}

/** Packs, the facet form for the chosen kind, and a paid sample run. */
export function Facets() {
  const view = useView();
  const { data: facets = [], isLoading, error } = useTool('list_facets', {});
  const current =
    facets.find((f) => f.id === view.facet) ?? (view.facet === 'new' ? undefined : facets[0]);
  const base = useMemo(() => (current ? plain(current) : blank), [current]);
  const [draft, setDraft] = useState<Facet>(base);
  useReset(base, () => setDraft(base));

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const save = async () => {
    if (!draft.id) {
      notify('A facet needs an id', true);
      return false;
    }
    if (!dirty) return true;
    const saved = await act('save_facet', draft);
    if (saved) {
      notify(`Saved ${saved.id}`);
      setView({ facet: saved.id });
    }
    return !!saved;
  };
  useActions({ save: () => void save() });

  const set = (patch: Partial<Facet>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panes id="facets" panes={['packs', 'form', 'sample']}>
        <Packs
          facets={facets}
          current={current?.id}
          actions={
            <Button variant="ghost" className="h-6" onClick={() => setView({ facet: 'new' })}>
              <Plus /> New
            </Button>
          }
        />
        <Divider />
        <Pane
          id="form"
          minSize={360}
          loading={isLoading}
          error={error}
          title={draft.title || draft.id || 'New facet'}
          actions={<span className="font-mono text-xs text-subtle">{draft.pack}</span>}
        >
          <Form draft={draft} set={set} />
        </Pane>
        <Divider />
        <Sample draft={draft} save={save} />
      </Panes>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-surface-1 px-3 text-xs text-subtle">
        <span className="mr-auto">
          {current?.custom
            ? 'Your copy. Removing it brings the built-in back.'
            : current
              ? 'Built-in. Saving creates your copy.'
              : 'A new facet.'}
          {dirty && ' Changing what the model sees asks that facet again.'}
        </span>
        {current?.custom && (
          <Button variant="danger" onClick={() => void act('delete_facet', { id: current.id })}>
            Delete copy
          </Button>
        )}
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(base)}>
          Discard
        </Button>
        <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
          Save <span className="font-mono text-2xs opacity-70">{keyLabel('mod+s')}</span>
        </Button>
      </div>
    </div>
  );
}
