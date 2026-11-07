/** The Dashboard's history, once the Activity screen: jobs of this session and stored plans. */
import { t } from '../i18n/index.ts';
import type { Job, Plan, PlanStatus } from '../../types.ts';
import { useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane } from '../components/pane.tsx';
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

const isPlanStatus = (value?: string): value is PlanStatus =>
  STATUSES.some((option) => option.value !== ALL && option.value === value);

/** Jobs of this session and every stored plan, newest first. `plans` leaves only that status. */
export function DashboardHistory() {
  const { plans: filterParam } = useView();
  // A status this list does not know shows everything, so an odd link cannot pick a bad filter.
  const shown = isPlanStatus(filterParam) ? filterParam : ALL;
  const filter = shown === ALL ? {} : { status: shown };
  const { data: plans, isLoading, error } = useTool('list_plans', filter);
  const { data: status } = useTool('status', {});
  const jobs = shown === ALL ? (status?.jobs ?? []) : [];
  const entries: Entry[] = [
    ...jobs.map((job) => ({ at: job.started_at, job })),
    ...(plans ?? []).map((plan) => ({ at: plan.created_at, plan })),
  ].toSorted((a, b) => b.at - a.at);
  return (
    <Pane
      id="history"
      title={t('History')}
      defaultSize="35%"
      minSize={280}
      actions={
        <Select
          label={t('Show')}
          className="h-6 w-32 text-xs"
          value={shown}
          options={STATUSES.map((option) => ({ ...option, label: t(option.label) }))}
          onChange={(next) => setView({ plans: next === ALL ? null : next })}
        />
      }
      loading={isLoading}
      error={error}
      empty={entries.length ? undefined : t('No plans or jobs yet.')}
    >
      <div className="space-y-2 p-3">
        {entries.map(({ job, plan }) =>
          job ? <Block key={job.id} job={job} /> : <Block key={plan!.id} plan={plan!} />,
        )}
      </div>
    </Pane>
  );
}
