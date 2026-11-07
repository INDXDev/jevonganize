import {
  answering,
  at,
  ctx,
  type DoDecide,
  events,
  FACETS,
  mock,
  organize,
  scanned,
  setupOrganize,
  startOrganize,
} from './organize-helpers.ts';
import { setImmediate as nextTick } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, test, vi } from 'vitest';
import { callTool, waitForJob } from '../src/core/tools.ts';
import type { Job } from '../src/types.ts';

setupOrganize();

/** Puts `count` organized files straight into the index, with no scan. */
function indexOrganizedFiles(count: number) {
  ctx.db.transaction(() => {
    for (let n = 0; n < count; n++) {
      const stat = { dev: '1', ino: String(n), size: 1, mtime_ns: '1', ctime_ns: '1' };
      const id = ctx.db.upsertFile({ path: at(`f${n}`), ...stat }, { edited: false });
      ctx.db.setFileResult(id, { status: 'organized', state_hash: `s${n}` });
    }
  });
}

/** Counts event-loop turns until stopped, so a test can see whether other work got a turn. */
function countEventLoopTurns() {
  let turns = 0;
  let stopped = false;
  const turn = () => {
    turns++;
    if (!stopped) setImmediate(turn);
  };
  turn();
  return {
    now: () => turns,
    stop: () => {
      stopped = true;
    },
  };
}

/** The garbage collector, which Node hides unless asked. */
function exposeGc(): () => void {
  setFlagsFromString('--expose-gc');
  return runInNewContext('gc') as () => void;
}

describe('job control', () => {
  test('only one organize runs at a time in a process', async () => {
    await scanned({ 'a.txt': 'x' });

    const first = await startOrganize();

    await expect(startOrganize()).rejects.toThrow('already running');
    await waitForJob(first.id);
  });

  test('cancel keeps paid answers, stores no plan, and leaves files new', async () => {
    await scanned({ 'a.txt': 'x', 'b.txt': 'y' });
    const answerAfterCancel = answering();
    let job: Job | undefined;
    mock.doDecide = async (options: Parameters<DoDecide>[0]) => {
      await callTool('cancel_job', { id: job!.id }, ctx);
      return answerAfterCancel(options);
    };

    job = await startOrganize();
    const final = await waitForJob(job.id);

    expect(final.status).toBe('cancelled');
    expect(await callTool('list_plans', {}, ctx)).toEqual([]);
    expect(ctx.db.fileByPath(at('a.txt'))?.status).toBe('new');
    await organize(); // the answers already paid for are reused
    expect(answerAfterCancel.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test('progress goes through emit, and the last job event is final', async () => {
    await scanned({ 'a.txt': 'x' });
    events.length = 0;

    await organize();

    const jobs = events.flatMap((event) => (event.type === 'job' ? [event.job] : []));
    expect(jobs.some((job) => job.status === 'running' && job.total === 1)).toBe(true);
    expect(jobs.at(-1)).toMatchObject({ status: 'done', done: 1 });
  });
});

describe('memory', () => {
  test('a finished file’s state is not kept until the run ends', async () => {
    const gc = exposeGc();
    ctx.config.concurrency = 1;
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    await scanned(Object.fromEntries(names.map((name) => [`${name}.txt`, `the text of ${name}`])));
    const reply = answering();
    let firstStatesAlive = 0;
    let calls = 0;
    mock.doDecide = vi.fn<DoDecide>(async (options) => {
      const isLastFile = ++calls === names.length;
      if (isLastFile) {
        await nextTick();
        gc();
        firstStatesAlive = mock.states.slice(0, 2).filter((state) => state.deref()).length;
      }
      return reply(options);
    });

    await organize();

    expect(calls).toBe(names.length);
    expect(firstStatesAlive).toBe(0);
  });
});

describe('estimate', () => {
  test('yields to the event loop while it works', async () => {
    indexOrganizedFiles(1000);
    const loop = countEventLoopTurns();
    const turnAtEachAnswerRead: number[] = [];
    const readAnswers = ctx.db.getAnswers.bind(ctx.db);
    ctx.db.getAnswers = (keys) => {
      turnAtEachAnswerRead.push(loop.now());
      return readAnswers(keys);
    };

    await callTool('estimate', { query: {}, facets: FACETS }, ctx);
    loop.stop();

    expect(turnAtEachAnswerRead.at(-1)).toBeGreaterThan(turnAtEachAnswerRead[0]!);
  });
});
