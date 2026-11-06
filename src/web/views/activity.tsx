import { t } from '../i18n/index.ts';
import type { Job, Plan, PlanStatus } from '../../types.ts';
import { useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane, Panes } from '../components/pane.tsx';
import { Select } from '../components/ui/field.tsx';
import { setView, useView } from '../tabs.ts';

const ALL = 'all';
const STATUSES = [
  { value: ALL, label: 'All plans' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'applied', label: 'Applied' },
  { value: 'undone', label: 'Undone' },
  { value: 'failed', label: 'Failed' },
] as const;

type Entry = { at: number; job?: Job; plan?: Plan };

/** Jobs of this session and every stored plan, newest first. A filter leaves only those plans. */
export function Activity() {
  const { section = ALL } = useView();
  const filter = section === ALL ? {} : { status: section as PlanStatus };
  const { data: plans, isLoading, error } = useTool('list_plans', filter);
  const { data: status } = useTool('status', {});
  const jobs = section === ALL ? (status?.jobs ?? []) : [];
  const entries: Entry[] = [
    ...jobs.map((job) => ({ at: job.started_at, job })),
    ...(plans ?? []).map((plan) => ({ at: plan.created_at, plan })),
  ].toSorted((a, b) => b.at - a.at);
  return (
    <Panes id="activity" panes={['log']}>
      <Pane
        id="log"
        title={t('Activity')}
        actions={
          <Select
            label={t('Show')}
            className="h-6 w-32 text-xs"
            value={section}
            options={STATUSES.map((option) => ({ ...option, label: t(option.label) }))}
            onChange={(next) => setView({ section: next === ALL ? null : next })}
          />
        }
        loading={isLoading}
        error={error}
        empty={entries.length ? undefined : t('No plans or jobs yet.')}
      >
        <div className="mx-auto max-w-3xl space-y-2 p-4">
          {entries.map(({ job, plan }) =>
            job ? <Block key={job.id} job={job} /> : <Block key={plan!.id} plan={plan!} />,
          )}
        </div>
      </Pane>
    </Panes>
  );
}
