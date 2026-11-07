import { t } from '../i18n/index.ts';
import { ChevronRight, FolderSync, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FacetInfo, Job, Library } from '../../types.ts';
import { organize, scanFolder, useTool, useViewOptions } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Filters } from '../components/filters.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { SendNotice } from '../components/send-notice.tsx';
import { Button } from '../components/ui/button.tsx';
import { Checkbox, Field, Input, Select, Switch } from '../components/ui/field.tsx';
import { formatCount, needsKey, shortPath } from '../lib.ts';
import { TopicsField } from './organize-vocabulary.tsx';
import { setView, useView } from '../tabs.ts';
import type { View } from '../view-query.ts';
import { useViewScope } from '../vfolder-query.ts';

const ALL = '__all';

function tickState(ticked: number, total: number) {
  if (ticked === total) return true;
  return ticked ? 'indeterminate' : false;
}

/** Packs and their facets. The ticks are this run's `--facets`, so nothing here changes config. */
function FacetPicker(props: {
  facets: FacetInfo[];
  chosen: Set<string>;
  onChange: (chosen: Set<string>) => void;
}) {
  const { facets, chosen, onChange } = props;
  const packs = useMemo(() => [...Map.groupBy(facets, (f) => f.pack)], [facets]);
  const set = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  return (
    <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
      {packs.map(([pack, list]) => {
        const ids = list.map((f) => f.id);
        const on = ids.filter((id) => chosen.has(id)).length;
        return (
          <li key={pack}>
            <details className="group">
              <summary className="flex h-row cursor-default list-none items-center gap-2 px-2 text-sm">
                <ChevronRight className="size-3 shrink-0 text-subtle group-open:rotate-90" />
                <Checkbox
                  aria-label={t('Pack {pack}', { pack })}
                  checked={tickState(on, ids.length)}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(next) => set(ids, next === true)}
                />
                <span className="min-w-0 flex-1 truncate">{pack}</span>
                <span className="font-mono text-xs text-subtle">
                  {on}/{ids.length}
                </span>
              </summary>
              <div className="grid grid-cols-2 gap-x-3 px-7 pb-1.5">
                {list.map((f) => (
                  <label
                    key={f.id}
                    title={f.instructions ?? f.title}
                    className="flex h-dense min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    <Checkbox
                      checked={chosen.has(f.id)}
                      onCheckedChange={(next) => set([f.id], next === true)}
                    />
                    <span className="truncate">{f.title}</span>
                  </label>
                ))}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

const newest = (a: Job, b: Job) => b.started_at - a.started_at;

/** What is running, then the last run's outcome and its plan. */
function Run({ jobs }: { jobs: Job[] }) {
  const running = jobs.filter((j) => j.status === 'running');
  const last = jobs.find((j) => j.kind === 'organize' && j.status !== 'running');
  const idle = !running.length;
  const planId = idle ? last?.plan_id : undefined;
  const { data: plan } = useTool('get_plan', { id: planId! }, { enabled: !!planId });
  const { data: status } = useTool('status', {});
  return (
    <div className="mx-auto max-w-2xl space-y-2 p-4">
      {running.map((job) => (
        <Block key={job.id} job={job} />
      ))}
      {idle && last && <Block job={last} />}
      {idle && plan && <Block plan={plan} />}
      {idle && !!status?.reviews && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setView({ screen: 'review', section: null })}
        >
          {t('{count} items need review', { count: formatCount(status.reviews) })}
        </button>
      )}
    </div>
  );
}

function folderOptions(libraries: Library[], current?: string) {
  const paths = new Set([...libraries.map((l) => l.path), ...(current ? [current] : [])]);
  return [
    { value: ALL, label: t('All libraries') },
    ...[...paths].map((path) => ({ value: path, label: shortPath(path) })),
  ];
}

/** The run being set up: its scope, facets and estimate, and the call that starts it. */
function useRunSetup() {
  const view = useView();
  const { data: status } = useTool('status', {});
  const { data: facets = [] } = useTool('list_facets', {});
  const { data: libraries = [] } = useTool('list_libraries', {});
  const options = useViewOptions();
  const [limit, setLimit] = useState<number>();
  const [picked, setPicked] = useState<Set<string>>();
  const [apply, setApply] = useState(true);
  const [problem, setProblem] = useState('');

  const enabled = useMemo(
    () => new Set(facets.filter((f) => f.enabled).map((f) => f.id)),
    [facets],
  );
  const chosen = picked ?? enabled;
  const scope = useViewScope(view, options);
  const input = {
    query: { ...scope, limit },
    facets: picked && [...picked],
  };
  const { data: estimate, error } = useTool('estimate', input, { enabled: !!scope });

  const jobs = (status?.jobs ?? []).toSorted(newest);
  const busy = jobs.some((j) => j.kind === 'organize' && j.status === 'running');
  const missingKey = status ? needsKey(status) : false;
  const canStart = !busy && !missingKey && chosen.size > 0 && !!estimate?.files;
  const start = async () => {
    setProblem('');
    await organize(input, apply).catch((e: Error) => setProblem(e.message));
  };

  return {
    view,
    status,
    facets,
    libraries,
    limit,
    setLimit,
    picked,
    setPicked,
    apply,
    setApply,
    canChoose: !missingKey,
    problem,
    chosen,
    estimate,
    error,
    jobs,
    missingKey,
    canStart,
    start,
  };
}

type RunSetup = ReturnType<typeof useRunSetup>;

function FolderField({ view, libraries }: { view: View; libraries: Library[] }) {
  return (
    <Field label={t('Folder')}>
      <span className="flex items-center gap-2">
        <Select
          label={t('Folder')}
          className="w-64 font-mono text-xs"
          value={view.folder ?? ALL}
          options={folderOptions(libraries, view.folder)}
          onChange={(folder) => setView({ folder: folder === ALL ? null : folder })}
        />
        <Button onClick={() => void scanFolder(view.folder)}>
          <FolderSync /> {t('Scan')}
        </Button>
      </span>
      {view.vfolder && (
        <span className="mt-1 flex items-center gap-2 text-xs text-subtle">
          {t('Only files in the virtual folder {name}', { name: view.vname ?? view.vfolder })}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setView({ vfolder: null, vname: null })}
          >
            {t('Leave the folder')}
          </button>
        </span>
      )}
    </Field>
  );
}

function MissingKey({ provider }: { provider?: string }) {
  return (
    <p className="text-sm text-warn">
      {t('No API key for {provider}.', { provider: provider ?? t('your provider') })}{' '}
      <button
        type="button"
        className="underline"
        onClick={() => setView({ screen: 'settings', section: 'keys' })}
      >
        {t('Add one in Settings')}
      </button>
    </p>
  );
}

/** The body of the setup pane: scope, facets, the send notice and anything in the way. */
function SetupForm({ setup }: { setup: RunSetup }) {
  const { view, status, estimate, picked, problem, error } = setup;
  const facetsHelp = picked
    ? t('For this run only. Settings stay as they are.')
    : t('The enabled facets. Tick others for this run only.');
  return (
    <div className="space-y-1 p-4">
      <FolderField view={view} libraries={setup.libraries} />
      <Filters view={view} className="pb-2" />
      <Field
        label={t('Limit')}
        help={t('Organize at most this many files. Empty means all of them.')}
      >
        <Input
          type="number"
          min={1}
          aria-label={t('Limit')}
          placeholder={t('All')}
          className="w-28 font-mono"
          value={setup.limit ?? ''}
          onChange={(e) => setup.setLimit(Number(e.target.value) || undefined)}
        />
      </Field>
      <Field label={t('Facets')} help={facetsHelp}>
        <FacetPicker facets={setup.facets} chosen={setup.chosen} onChange={setup.setPicked} />
      </Field>
      <TopicsField folder={view.folder} canChoose={setup.canChoose} />
      <section className="space-y-1.5 border-t pt-3">
        <h3 className="label">{t('Before you start')}</h3>
        <SendNotice estimate={estimate} provider={status?.provider ?? t('your provider')} />
        <p className="text-sm text-muted-foreground">
          {' '}
          {setup.apply
            ? t(
                'Tags are written when the run ends, and undo reverses them. Answers are cached, so running the same files again costs nothing.',
              )
            : t(
                'Nothing is written until you apply the plan. Answers are cached, so running the same files again costs nothing.',
              )}{' '}
        </p>
      </section>
      {setup.missingKey && <MissingKey provider={status?.provider} />}
      {(problem || error) && (
        <p role="alert" className="text-sm text-destructive">
          {problem || error?.message}
        </p>
      )}
    </div>
  );
}

function StartBar({ setup }: { setup: RunSetup }) {
  const { apply, setApply, canStart, estimate, start } = setup;
  return (
    <div className="flex items-center justify-end gap-3 p-2">
      <span className="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground">
        <Switch aria-label={t('Apply when ready')} checked={apply} onCheckedChange={setApply} />
        {t('Apply when ready')}
      </span>
      <Button variant="primary" disabled={!canStart} onClick={() => void start()}>
        <Sparkles />{' '}
        {t('Organize {count} files', { count: estimate ? formatCount(estimate.files) : '—' })}
      </Button>
    </div>
  );
}

/** `organize` on screen: choose the files and facets, see the cost, then watch it run. */
export function Organize() {
  const setup = useRunSetup();
  const { jobs } = setup;
  return (
    <Panes id="organize" panes={['setup', 'run']}>
      <Pane
        id="setup"
        title={t('Organize')}
        defaultSize="48%"
        minSize={380}
        footer={<StartBar setup={setup} />}
      >
        <SetupForm setup={setup} />
      </Pane>
      <Divider />
      <Pane
        id="run"
        title={t('Run')}
        minSize={320}
        empty={jobs.length ? undefined : t('Nothing has run yet. Progress appears here.')}
      >
        <Run jobs={jobs} />
      </Pane>
    </Panes>
  );
}
