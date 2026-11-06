/** Background jobs: the work a tool starts and a front end follows. */
import { randomBytes } from 'node:crypto';
import type { Job } from '../../types.ts';
import { UserError } from '../config.ts';
import type { JobRun } from '../plans.ts';
import type { Context } from './shared.ts';

const KEPT_JOBS = 20;
/** At most this often for plain progress: a line of NDJSON or an SSE event per file is a lot. */
const PROGRESS_MS = 250;
const PROGRESS_FIELDS = new Set(['done', 'current', 'tokens', 'cost_usd']);

interface RunningJob {
  job: Job;
  controller: AbortController;
  finished: Promise<Job>;
}

/** Every job this process knows, by id. */
export const jobs = new Map<string, RunningJob>();

/** A copy of a job, safe to hand out while it runs. */
export const snapshot = (job: Job): Job => ({ ...job });

/** The jobs still running. */
export const running = () => [...jobs.values()].filter(({ job }) => job.status === 'running');

function forgetOldJobs(): void {
  const ended = [...jobs.values()].filter(({ job }) => job.status !== 'running');
  for (const { job } of ended.slice(0, -KEPT_JOBS)) jobs.delete(job.id);
}

/** Starts work in the background and returns its `Job`. Progress goes out through `ctx.emit`. */
export function startJob(
  kind: Job['kind'],
  ctx: Context,
  work: (run: JobRun) => Promise<void>,
  start: Partial<Job> = {},
): Job {
  const controller = new AbortController();
  const job: Job = {
    id: randomBytes(4).toString('hex'),
    kind,
    status: 'running',
    started_at: Date.now(),
    done: 0,
    total: 0,
    ...start,
  };
  let lastEmit = 0;
  let trailing: NodeJS.Timeout | undefined;
  const send = () => {
    clearTimeout(trailing);
    trailing = undefined;
    lastEmit = Date.now();
    ctx.emit({ type: 'job', job: snapshot(job) });
  };
  const update = (patch: Partial<Job>) => {
    Object.assign(job, patch);
    const progress =
      job.status === 'running' && Object.keys(patch).every((key) => PROGRESS_FIELDS.has(key));
    const wait = lastEmit + PROGRESS_MS - Date.now();
    if (!progress || wait <= 0) {
      send();
      return;
    }
    // The last file before a long one must still show, so a skipped update comes out later.
    trailing ??= setTimeout(send, wait);
    trailing.unref();
  };
  const finished = Promise.resolve()
    .then(() => work({ signal: controller.signal, update }))
    .then(() => update({ status: controller.signal.aborted ? 'cancelled' : 'done' }))
    .catch((error: unknown) => {
      if (controller.signal.aborted) update({ status: 'cancelled' });
      else update({ status: 'failed', error: (error as Error).message });
    })
    .then(() => {
      update({ current: undefined });
      forgetOldJobs();
      return snapshot(job);
    });
  jobs.set(job.id, { job, controller, finished });
  return snapshot(job);
}

/** Resolves with a job's final state. The CLI waits here, since a tool only starts its job. */
export async function waitForJob(id: string): Promise<Job> {
  const entry = jobs.get(id);
  if (!entry) throw new UserError(`There is no job ${id}`);
  return entry.finished;
}
