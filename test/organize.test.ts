import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as nextTick } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { APICallError } from 'ai';
import { Experimental_DecisionMockModelV4 as MockDecisionModel } from 'ai/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import type * as Extract from '../src/extract/index.ts';
import { UserError } from '../src/core/config.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, type Context, openContext, waitForJob } from '../src/core/tools.ts';
import type { Job, ServerEvent } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

type DoDecide = MockDecisionModel['doDecide'];
type Reply = Awaited<ReturnType<DoDecide>>['answers'];

const mock = vi.hoisted(() => ({
  doDecide: undefined as unknown,
  native: true,
  noKey: false,
  profiles: [] as (string | undefined)[],
  states: [] as WeakRef<object>[],
}));

vi.mock('../src/extract/index.ts', async (original) => {
  const real = await original<typeof Extract>();
  return {
    ...real,
    extractFile: async (...args: Parameters<typeof real.extractFile>) => {
      const state = await real.extractFile(...args);
      mock.states.push(new WeakRef(state));
      return state;
    },
  };
});

vi.mock('../src/ai/providers.ts', async (original) => {
  const real = await original<typeof Providers>();
  return {
    ...real,
    resolveModel: async (_config: unknown, profile?: string) => {
      if (mock.noKey) throw new (await import('../src/core/config.ts')).UserError('no key');
      mock.profiles.push(profile);
      const caps = { ...real.capabilities('openai', 'gpt-6-luna'), native: mock.native };
      const model = new MockDecisionModel({ doDecide: mock.doDecide as DoDecide });
      return { model, provider: 'openai', modelId: `m-${profile ?? 'default'}`, caps };
    },
  };
});

vi.setConfig({ testTimeout: 30_000 }); // real workers, which a busy machine can hold up

const home = useTempHome();
let ctx: Context;
let root: string;
let events: ServerEvent[];
const at = (name: string) => join(root, name);

/** A complete distribution, as the SDK requires. */
function spread(criteria: object, label: string, p: number) {
  const rest = Object.keys(criteria).filter((key) => key !== label);
  return Object.fromEntries([
    [label, p],
    ...rest.map((key) => [key, (1 - p) / rest.length] as const),
  ]);
}

/** Answers `doc-type` with the given label and confidence, and every flag with `flag`. */
function answering(label = 'invoice', p = 0.99, flag = 0.01) {
  return vi.fn<DoDecide>(async ({ questions }) => {
    const answers: Reply = {};
    for (const [id, question] of Object.entries(questions)) {
      answers[id] =
        question.type === 'choice'
          ? { type: 'choice', choice: label, probabilities: spread(question.criteria, label, p) }
          : question.type === 'boolean'
            ? { type: 'boolean', probability: flag }
            : { type: 'score', score: 0, probabilities: { 0: 0.99 } };
    }
    return { answers, usage: { inputTokens: 100 }, warnings: [] };
  });
}

const answeredAll = (questions: Record<string, { type: string }>): Reply =>
  Object.fromEntries(
    Object.keys(questions).map((id) => [id, { type: 'boolean' as const, probability: 0.5 }]),
  );

const apiError = (statusCode: number) =>
  new APICallError({
    message: 'no',
    url: 'u',
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

const FACETS = ['doc-type', 'has-signature'];

async function scan() {
  return waitForJob((await callTool('scan', { path: root }, ctx)).id);
}

async function organize(query = {}, facets: string[] = FACETS): Promise<Job> {
  return waitForJob((await callTool('organize', { query, facets }, ctx)).id);
}

const fileId = (name: string) => ctx.db.fileByPath(at(name))!.id;

beforeEach(async () => {
  root = join(home(), 'library');
  await mkdir(root);
  events = [];
  ctx = await openContext('ui', (event) => events.push(event));
  await callTool('add_library', { path: root }, ctx);
  mock.doDecide = answering();
  mock.native = true;
  mock.noKey = false;
  mock.profiles = [];
  mock.states = [];
});

afterEach(() => ctx.db.close());

test('end to end: scan, organize, apply, read from disk, undo', async () => {
  const path = at('invoice.txt');
  await writeFile(path, 'Invoice 44 for Acme');
  await writeTags(path, ['mine']);
  expect((await scan()).scan).toMatchObject({ files: 1, added: 1 });

  const job = await organize();
  expect(job).toMatchObject({ status: 'done', done: 1, total: 1, tokens: 100 });
  expect(await readTags(path)).toEqual(['mine']); // a plan writes nothing

  const planned = await callTool('get_plan', { id: job.plan_id! }, ctx);
  expect(planned).toMatchObject({ source: 'organize', status: 'proposed' });
  expect(planned.summary.added).toEqual({ 'doc-type:invoice': 1 });

  const applied = await waitForJob((await callTool('apply_plan', { id: planned.id }, ctx)).id);
  expect(applied).toMatchObject({ status: 'done', failed: 0 });
  expect(await readTags(path)).toEqual(['doc-type:invoice', 'mine']);
  expect(ctx.db.fileTags(fileId('invoice.txt'))).toContainEqual({
    tag: 'doc-type:invoice',
    ai: true,
  });

  await waitForJob((await callTool('undo_plan', { id: planned.id }, ctx)).id);
  expect(await readTags(path)).toEqual(['mine']);
  expect((await callTool('get_plan', { id: planned.id }, ctx)).status).toBe('undone');
});

describe('thresholds', () => {
  test('the middle band goes to review, not the plan, and a low answer is dropped', async () => {
    await writeFile(at('a.txt'), 'text');
    await scan();
    mock.doDecide = answering('invoice', 0.6);
    const job = await organize();
    expect((await callTool('get_plan', { id: job.plan_id! }, ctx)).ops).toEqual([]);
    const reviews = await callTool('list_reviews', {}, ctx);
    expect(reviews).toMatchObject([{ tag: 'doc-type:invoice', confidence: 0.6, kind: 'suggest' }]);
    expect(events).toContainEqual({ type: 'reviews', count: 1 });
  });

  test('an estimated answer never auto-applies, however confident', async () => {
    await writeFile(at('a.txt'), 'text');
    await scan();
    mock.native = false;
    const job = await organize();
    expect((await callTool('get_plan', { id: job.plan_id! }, ctx)).ops).toEqual([]);
    expect(await callTool('list_reviews', {}, ctx)).toHaveLength(1);
  });

  test('a rejected tag is not proposed again', async () => {
    await writeFile(at('a.txt'), 'text');
    await scan();
    ctx.db.rejectTag(fileId('a.txt'), 'doc-type:invoice', 'no');
    const job = await organize();
    expect((await callTool('get_plan', { id: job.plan_id! }, ctx)).ops).toEqual([]);
  });
});

describe('caching and cost', () => {
  test('a second run costs nothing, and estimate then counts the file as cached', async () => {
    await writeFile(at('a.txt'), 'text');
    await scan();
    const before = await callTool('estimate', { query: {}, facets: FACETS }, ctx);
    expect(before).toMatchObject({ files: 1, cached: 0, facets: 2 });
    expect(before.tokens).toBeGreaterThan(0);
    await organize();
    const spy = mock.doDecide as ReturnType<typeof answering>;
    expect(spy).toHaveBeenCalledTimes(1);
    await organize();
    expect(spy).toHaveBeenCalledTimes(1);
    const row = ctx.db.fileByPath(at('a.txt'))!;
    expect(row).toMatchObject({ status: 'organized', mime: 'text/plain' });
    expect(row.hash).toMatch(/^f1:[0-9a-f]{64}$/);
    expect(ctx.db.fileAnswers(row.id).length).toBeGreaterThan(0); // linked with the right key
    expect(ctx.db.getContent(row.id)).toContain('text');
  });

  test('facets group by profile, with one decide each', async () => {
    await callTool(
      'save_facet',
      {
        id: 'seen',
        pack: 'mine',
        title: 'Seen',
        kind: 'flag',
        instructions: 'Q?',
        applies_to: [],
        weight: 1,
        profile: 'vision',
      },
      ctx,
    );
    await writeFile(at('a.txt'), 'text');
    await scan();
    await organize({}, ['doc-type', 'seen']);
    expect(mock.profiles).toEqual([undefined, 'vision']);
    expect((mock.doDecide as ReturnType<typeof answering>).mock.calls.length).toBe(2);
  });
});

describe('what is never sent', () => {
  test('a row for an excluded file is skipped, even if the scan predates the rule', async () => {
    await writeFile(at('a.txt'), 'public');
    await writeFile(at('b.txt'), 'hidden');
    await scan();
    ctx.config.exclude.push('b.txt');
    const job = await organize();
    expect(job.warnings?.join()).toContain('excluded');
    const sent = JSON.stringify((mock.doDecide as ReturnType<typeof answering>).mock.calls);
    expect(sent).toContain('public');
    expect(sent).not.toContain('hidden');
  });

  test('a secret that reached the index is not read, whatever the config says', async () => {
    await writeFile(at('a.txt'), 'x');
    await scan();
    const path = at('.env');
    await writeFile(path, 'TOKEN=abc');
    const stamp = { dev: '1', ino: '1', size: 9, mtime_ns: '1', ctime_ns: '1' };
    ctx.db.upsertFile({ path, ...stamp }, { edited: false });
    const job = await organize();
    expect(job.done).toBe(2);
    expect(
      JSON.stringify((mock.doDecide as ReturnType<typeof answering>).mock.calls),
    ).not.toContain('TOKEN');
    expect(ctx.db.getContent(ctx.db.fileByPath(path)!.id)).toBeUndefined();
  });
});

describe('failures', () => {
  test('no key refuses before a job starts', async () => {
    mock.noKey = true;
    await expect(callTool('organize', { query: {}, facets: FACETS }, ctx)).rejects.toThrow(
      UserError,
    );
    expect(
      (await callTool('status', {}, ctx)).jobs.filter((job) => job.kind === 'organize'),
    ).toEqual(expect.not.arrayContaining([expect.objectContaining({ status: 'running' })]));
  });

  test('a rejected key stops the job, with no plan', async () => {
    await writeFile(at('a.txt'), 'x');
    await scan();
    mock.doDecide = () => Promise.reject(apiError(401));
    const job = await organize();
    expect(job).toMatchObject({ status: 'failed' });
    expect(job.error).toContain('rejected the API key');
    expect(await callTool('list_plans', {}, ctx)).toEqual([]);
  });

  test('another provider error fails that file, and the job goes on', async () => {
    await writeFile(at('bad.txt'), 'bad');
    await writeFile(at('good.txt'), 'good');
    await scan();
    const good = answering();
    mock.doDecide = (options: Parameters<DoDecide>[0]) =>
      JSON.stringify(options.state).includes('bad.txt')
        ? Promise.reject(apiError(500))
        : good(options);
    const job = await organize();
    expect(job).toMatchObject({ status: 'done', failed: 1, done: 2 });
    expect(ctx.db.fileByPath(at('bad.txt'))).toMatchObject({ status: 'failed' });
    expect(ctx.db.fileByPath(at('good.txt'))).toMatchObject({ status: 'organized' });
    expect((await callTool('get_plan', { id: job.plan_id! }, ctx)).ops).toHaveLength(1);
  });

  test('a file that vanished, or is too large to read, is failed and costs no call', async () => {
    await writeFile(at('gone.txt'), 'x');
    await writeFile(
      at('big.pdf'),
      Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 ** 21)]),
    );
    await scan();
    await rm(at('gone.txt'));
    ctx.config.budget.max_parse_mb = 1;
    const job = await organize();
    expect(job).toMatchObject({ status: 'done', failed: 2, total: 2 });
    expect(mock.doDecide).not.toHaveBeenCalled();
  });
});

describe('job control', () => {
  test('only one organize runs at a time in a process', async () => {
    await writeFile(at('a.txt'), 'x');
    await scan();
    const first = await callTool('organize', { query: {}, facets: FACETS }, ctx);
    await expect(callTool('organize', { query: {}, facets: FACETS }, ctx)).rejects.toThrow(
      'already running',
    );
    await waitForJob(first.id);
  });

  test('cancel keeps paid answers, stores no plan, and leaves files new', async () => {
    await writeFile(at('a.txt'), 'x');
    await writeFile(at('b.txt'), 'y');
    await scan();
    const inner = answering();
    let job: Job | undefined;
    mock.doDecide = async (options: Parameters<DoDecide>[0]) => {
      await callTool('cancel_job', { id: job!.id }, ctx);
      return inner(options);
    };
    job = await callTool('organize', { query: {}, facets: FACETS }, ctx);
    const final = await waitForJob(job.id);
    expect(final.status).toBe('cancelled');
    expect(await callTool('list_plans', {}, ctx)).toEqual([]);
    expect(ctx.db.fileByPath(at('a.txt'))?.status).toBe('new');
    await organize(); // the answers already paid for are reused
    expect(inner.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test('progress goes through emit, and the last job event is final', async () => {
    await writeFile(at('a.txt'), 'x');
    await scan();
    events.length = 0;
    await organize();
    const jobs = events.flatMap((event) => (event.type === 'job' ? [event.job] : []));
    expect(jobs.some((job) => job.status === 'running' && job.total === 1)).toBe(true);
    expect(jobs.at(-1)).toMatchObject({ status: 'done', done: 1 });
  });
});

/** Tags a file through the whole flow, then changes it, so the next run asks again. */
/** Saves over the bytes of an open file. `writeFile` would delete the tag stream on Windows. */
async function saveInPlace(name: string, text: string) {
  const file = await open(at(name), 'r+');
  await file.truncate(0);
  await file.write(text, 0);
  await file.close();
}

async function organizedThenEdited(tags: string[] = []) {
  await writeFile(at('a.txt'), 'first');
  if (tags.length > 0) await writeTags(at('a.txt'), tags);
  await scan();
  const { plan_id: id } = await organize();
  await waitForJob((await callTool('apply_plan', { id: id! }, ctx)).id);
  await saveInPlace('a.txt', 'second');
  await scan();
}

describe('memory', () => {
  test('a finished file’s state is not kept until the run ends', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    ctx.config.concurrency = 1;
    const files = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const name of files) await writeFile(at(`${name}.txt`), `the text of ${name}`);
    await scan();
    const reply = answering();
    let alive = 0;
    let calls = 0;
    mock.doDecide = vi.fn<DoDecide>(async (options) => {
      if (++calls === files.length) {
        await nextTick();
        gc();
        alive = mock.states.slice(0, 2).filter((state) => state.deref()).length;
      }
      return reply(options);
    });
    await organize();
    expect(calls).toBe(files.length);
    expect(alive).toBe(0);
  });
});

describe('estimate', () => {
  test('yields to the event loop while it works', async () => {
    ctx.db.transaction(() => {
      for (let n = 0; n < 1000; n++) {
        const file = { path: at(`f${n}`), dev: '1', ino: String(n), size: 1 };
        const id = ctx.db.upsertFile({ ...file, mtime_ns: '1', ctime_ns: '1' }, { edited: false });
        ctx.db.setFileResult(id, { status: 'organized', state_hash: `s${n}` });
      }
    });
    let ticks = 0;
    let finished = false;
    const beat = () => {
      ticks++;
      if (!finished) setImmediate(beat);
    };
    beat();
    const seen: number[] = [];
    const real = ctx.db.getAnswers.bind(ctx.db);
    ctx.db.getAnswers = (keys) => {
      seen.push(ticks);
      return real(keys);
    };
    await callTool('estimate', { query: {}, facets: FACETS }, ctx);
    finished = true;
    expect(seen.at(-1)).toBeGreaterThan(seen[0]!);
  });
});

describe('provenance', () => {
  test('a refused facet keeps its tags', async () => {
    await organizedThenEdited();
    const refusing = vi.fn<DoDecide>(async ({ questions }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((id) => [id, { type: 'refusal' as const }]),
      ),
      usage: { inputTokens: 1 },
      warnings: [],
    }));
    mock.doDecide = refusing;
    const job = await organize();
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.removed).toEqual({});
  });

  test('a facet the model answered with `other` still drops the tag it no longer supports', async () => {
    await organizedThenEdited();
    mock.doDecide = answering('other');
    const job = await organize();
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.removed).toEqual({ 'doc-type:invoice': 1 });
  });

  test('a tag held back for review counts towards max_tags', async () => {
    await organizedThenEdited(['mine']);
    ctx.config.max_tags = 2;
    mock.doDecide = answering('invoice', 0.6, 0.99); // doc-type:invoice to review, flag to apply
    const job = await organize({}, ['doc-type', 'needs-action']);
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.added).toEqual({});
    expect(plan.summary.removed).toEqual({});
  });

  test('the cost of a refused call stays counted when the file then fails', async () => {
    await writeFile(at('a.txt'), 'text');
    await scan();
    let calls = 0;
    mock.doDecide = vi.fn<DoDecide>(async ({ questions }) => {
      if (++calls > 1) throw apiError(400);
      const [first = ''] = Object.keys(questions);
      return {
        answers: { ...answeredAll(questions), [first]: { type: 'refusal' as const } },
        usage: { inputTokens: 100 },
        warnings: [],
      };
    });
    const job = await organize({}, ['doc-type', 'needs-action']);
    expect(job).toMatchObject({ failed: 1, tokens: 100 });
  });

  test('a new answer replaces a tag the app wrote, in a plan, and never a person’s', async () => {
    await writeFile(at('a.txt'), 'first');
    await scan();
    const first = await organize();
    await waitForJob((await callTool('apply_plan', { id: first.plan_id! }, ctx)).id);

    await saveInPlace('a.txt', 'second version');
    await scan();
    mock.doDecide = answering('receipt');
    const second = await organize();
    const plan = await callTool('get_plan', { id: second.plan_id! }, ctx);
    expect(plan.ops).toMatchObject([{ add: ['doc-type:receipt'], remove: ['doc-type:invoice'] }]);
  });

  test('a person’s tag in a single-valued facet blocks the answer', async () => {
    await writeFile(at('a.txt'), 'x');
    await writeTags(at('a.txt'), ['doc-type:contract']);
    await scan();
    const job = await organize();
    expect((await callTool('get_plan', { id: job.plan_id! }, ctx)).ops).toEqual([]);
  });

  test('an unchanged rerun proposes nothing', async () => {
    await writeFile(at('a.txt'), 'x');
    await scan();
    const first = await organize();
    await waitForJob((await callTool('apply_plan', { id: first.plan_id! }, ctx)).id);
    const second = await organize();
    expect((await callTool('get_plan', { id: second.plan_id! }, ctx)).ops).toEqual([]);
  });
});
