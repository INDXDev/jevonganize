import { t } from '../i18n/index.ts';
import { Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Estimate, Facet, FacetInfo, Job } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { Checkbox } from '../components/ui/field.tsx';
import { cn, keyLabel, useReset } from '../lib.ts';
import { activeTab, notify, setView, useActions, useView } from '../tabs.ts';
import { parseView } from '../view-query.ts';
import { Form } from './facets-form.tsx';

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

function sampleCost({ files, cost_usd: cost }: Estimate) {
  return `${t('{count} files', { count: files })} · ${cost === null ? t('cost unknown') : t('about ${cost}', { cost: cost.toFixed(2) })}`;
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
      title={t('Sample on 20 files')}
      defaultSize="26%"
      minSize={240}
      className="space-y-3 p-3"
    >
      <p className="font-mono text-xs text-muted-foreground">
        {estimate ? sampleCost(estimate) : t('Save an id to estimate.')}
      </p>
      <p className="text-xs text-subtle">
        {' '}
        {t(
          'Saves, then asks the model about 20 files in the current folder. It spends money and stores a plan like any other run. Nothing is written until you apply it.',
        )}{' '}
      </p>
      <Button disabled={!draft.id} onClick={() => void run()}>
        {t('Run on sample')}
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
      title={t('Facets')}
      actions={actions}
      defaultSize="22%"
      minSize={200}
      className="p-1.5"
    >
      {packs.map(([pack, list]) => (
        <section key={pack} className="pb-2">
          <label className="flex h-row items-center gap-2 px-1.5 text-sm font-medium">
            <Checkbox
              aria-label={t('Pack {pack}', { pack })}
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
                aria-label={t('Facet {id}', { id: f.id })}
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
              {f.custom && <span className="text-2xs text-subtle">{t('custom')}</span>}
            </div>
          ))}
        </section>
      ))}
    </Pane>
  );
}

/** The edited copy of a facet, which resets when another facet opens, and how it is saved. */
function useFacetDraft(current?: FacetInfo) {
  const base = useMemo(() => (current ? plain(current) : blank), [current]);
  const [draft, setDraft] = useState<Facet>(base);
  useReset(base, () => setDraft(base));

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const save = async () => {
    if (!draft.id) {
      notify(t('A facet needs an id'), true);
      return false;
    }
    if (!dirty) return true;
    const saved = await act('save_facet', draft);
    if (saved) {
      notify(t('Saved {id}', { id: saved.id }));
      setView({ facet: saved.id });
    }
    return !!saved;
  };
  useActions({ save: () => void save() });

  const set = (patch: Partial<Facet>) => setDraft((d) => ({ ...d, ...patch }));
  return { draft, set, dirty, save, discard: () => setDraft(base) };
}

function originNote(current?: FacetInfo) {
  if (current?.custom) return t('Your copy. Removing it brings the built-in back.');
  return current ? t('Built-in. Saving creates your copy.') : t('A new facet.');
}

function SaveBar(props: {
  current?: FacetInfo;
  dirty: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { current, dirty, onDiscard, onSave } = props;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-surface-1 px-3 text-xs text-subtle">
      <span className="mr-auto">
        {originNote(current)}
        {dirty && t(' Changing what the model sees asks that facet again.')}
      </span>
      {current?.custom && (
        <Button variant="danger" onClick={() => void act('delete_facet', { id: current.id })}>
          {t('Delete copy')}
        </Button>
      )}
      <Button variant="ghost" disabled={!dirty} onClick={onDiscard}>
        {t('Discard')}
      </Button>
      <Button variant="primary" disabled={!dirty} onClick={onSave}>
        {' '}
        {t('Save')} <span className="font-mono text-2xs opacity-70">{keyLabel('mod+s')}</span>
      </Button>
    </div>
  );
}

/** Packs, the facet form for the chosen kind, and a paid sample run. */
export function Facets() {
  const view = useView();
  const { data: facets = [], isLoading, error } = useTool('list_facets', {});
  const current =
    facets.find((f) => f.id === view.facet) ?? (view.facet === 'new' ? undefined : facets[0]);
  const { draft, set, dirty, save, discard } = useFacetDraft(current);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panes id="facets" panes={['packs', 'form', 'sample']}>
        <Packs
          facets={facets}
          current={current?.id}
          actions={
            <Button variant="ghost" className="h-6" onClick={() => setView({ facet: 'new' })}>
              <Plus /> {t('New')}
            </Button>
          }
        />
        <Divider />
        <Pane
          id="form"
          minSize={360}
          loading={isLoading}
          error={error}
          title={draft.title || draft.id || t('New facet')}
          actions={<span className="font-mono text-xs text-subtle">{draft.pack}</span>}
        >
          <Form draft={draft} set={set} />
        </Pane>
        <Divider />
        <Sample draft={draft} save={save} />
      </Panes>
      <SaveBar current={current} dirty={dirty} onDiscard={discard} onSave={() => void save()} />
    </div>
  );
}
