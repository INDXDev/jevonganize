/** The mock's jobs: each counts up on a timer and sends the events a real job would. */
import type { Job } from '../../types.ts';
import { emit } from './mock-events.ts';
import { files } from './mock-files.ts';

const TICK_MS = 250;
/** A job ends in this many ticks, whatever its size. */
const TICKS = 8;
/** The tokens and cost of one organized file, roughly what a real model would take. */
export const TOKENS_PER_FILE = 3400;
export const COST_PER_FILE_USD = 0.00035;

/** Every job of this session, newest first. */
export const jobs: Job[] = [];
let nextJobNumber = 1;

function startJob(kind: Job['kind'], total: number): Job {
  const job: Job = {
    id: `job-${nextJobNumber++}`,
    kind,
    status: 'running',
    started_at: Date.now(),
    done: 0,
    total,
    ...(kind === 'organize' ? { tokens: 0, cost_usd: 0 } : {}),
  };
  jobs.unshift(job);
  return job;
}

function advance(job: Job, step: number) {
  job.done = Math.min(job.total, job.done + step);
  job.current = files[job.done % files.length]!.path;
  if (job.kind === 'organize') {
    job.tokens = job.done * TOKENS_PER_FILE;
    job.cost_usd = job.done * COST_PER_FILE_USD;
  }
}

/**
 * Starts a job that counts to `total` and then ends. `onDone` gives the fields a finished job
 * adds, such as its plan, and does the job's work.
 */
export function runJob(kind: Job['kind'], total: number, onDone?: () => Partial<Job>): Job {
  const job = startJob(kind, total);
  const step = Math.ceil(total / TICKS);
  const timer = setInterval(() => {
    if (job.status !== 'running') return clearInterval(timer);
    advance(job, step);
    if (job.done === total) {
      clearInterval(timer);
      Object.assign(job, { status: 'done', current: undefined }, onDone?.());
    }
    emit({ type: 'job', job: { ...job } });
  }, TICK_MS);
  return { ...job };
}

/** Stands in for `cancel_job`. */
export function cancelJob(id: string) {
  const job = jobs.find((entry) => entry.id === id);
  if (!job) return;
  job.status = 'cancelled';
  emit({ type: 'job', job: { ...job } });
}
