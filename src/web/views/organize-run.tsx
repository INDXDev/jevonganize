import { t } from '../i18n/index.ts';
import type { Job } from '../../types.ts';
import { useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { formatCount } from '../lib.ts';
import { setView } from '../tabs.ts';

/** Sorts jobs newest first. */
export const newestFirst = (a: Job, b: Job) => b.started_at - a.started_at;

function ReviewLink({ count }: { count: number }) {
  return (
    <button
      type="button"
      className="text-xs text-primary hover:underline"
      onClick={() => setView({ screen: 'tags', section: 'review' })}
    >
      {t('{count} items need review', { count: formatCount(count) })}
    </button>
  );
}

/** What is running, then, once nothing is, the last run's outcome, its plan and what waits in Review. */
export function Run({ jobs }: { jobs: Job[] }) {
  const runningJobs = jobs.filter((job) => job.status === 'running');
  const lastOrganize = jobs.find((job) => job.kind === 'organize' && job.status !== 'running');
  const isIdle = !runningJobs.length;
  const planId = isIdle ? lastOrganize?.plan_id : undefined;
  const { data: plan } = useTool('get_plan', { id: planId ?? '' }, { enabled: !!planId });
  const { data: status } = useTool('status', {});
  const reviewCount = status?.reviews ?? 0;
  return (
    <div className="mx-auto max-w-2xl space-y-2 p-4">
      {runningJobs.map((job) => (
        <Block key={job.id} job={job} />
      ))}
      {isIdle && lastOrganize && <Block job={lastOrganize} />}
      {isIdle && plan && <Block plan={plan} />}
      {isIdle && reviewCount > 0 && <ReviewLink count={reviewCount} />}
    </div>
  );
}
