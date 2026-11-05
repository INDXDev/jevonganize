import { useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane, Panes } from '../components/pane.tsx';

/** Every job and plan, newest first. */
export function Activity() {
  const { data: plans, isLoading, error } = useTool('list_plans', {});
  const { data: status } = useTool('status', {});
  const jobs = status?.jobs.filter((j) => j.status === 'running') ?? [];
  const sorted = plans?.toSorted((a, b) => b.created_at - a.created_at) ?? [];
  return (
    <Panes id="activity" panes={['log']}>
      <Pane
        id="log"
        title="Activity"
        loading={isLoading}
        error={error}
        empty={sorted.length || jobs.length ? undefined : 'No plans or jobs yet.'}
      >
        <div className="mx-auto max-w-3xl space-y-2 p-4">
          {jobs.map((job) => (
            <Block key={job.id} job={job} />
          ))}
          {sorted.map((plan) => (
            <Block key={plan.id} plan={plan} />
          ))}
        </div>
      </Pane>
    </Panes>
  );
}
