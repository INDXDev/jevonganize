/**
 * Shared setup of the organize tests: a mocked model, a temp library, and builders over them. Import
 * this first in a test file, so its `vi.mock` calls run before anything loads `core/tools.ts`.
 */
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APICallError } from 'ai';
import { Experimental_DecisionMockModelV4 as MockDecisionModel } from 'ai/test';
import { afterEach, beforeEach, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import type * as Extract from '../src/extract/index.ts';
import { writeTags } from '../src/core/tags.ts';
import { callTool, type Context, openContext, waitForJob } from '../src/core/tools.ts';
import type { Job, ServerEvent } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

/** The model call the tests replace. */
export type DoDecide = MockDecisionModel['doDecide'];
type Reply = Awaited<ReturnType<DoDecide>>['answers'];

/** What the mocks below read and record. */
const mock = vi.hoisted(() => ({
  doDecide: undefined as unknown,
  native: true,
  noKey: false,
  profiles: [] as (string | undefined)[],
  states: [] as WeakRef<object>[],
}));
export { mock };

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
      // Imported late: a mock factory runs before the test file's own imports.
      const { UserError } = await import('../src/core/config.ts');
      if (mock.noKey) throw new UserError('no key');
      mock.profiles.push(profile);
      const realCaps = real.capabilities('openai', 'gpt-6-luna');
      const caps = { ...realCaps, native: mock.native };
      const model = new MockDecisionModel({ doDecide: mock.doDecide as DoDecide });
      return { model, provider: 'openai', modelId: `m-${profile ?? 'default'}`, caps };
    },
  };
});

/** The context of the running test. */
export let ctx: Context;
/** What the running test's context has emitted. */
export let events: ServerEvent[];
let root: string;
/** A path in the running test's library. */
export const at = (name: string) => join(root, name);

type Question = Parameters<DoDecide>[0]['questions'][string];
type Answer = Reply[string];

/**
 * A complete distribution over the labels, as the SDK requires: `chosen` gets `probability`, and the
 * other labels share the rest evenly.
 */
function distributionPeakingAt(labels: object, chosen: string, probability: number) {
  const others = Object.keys(labels).filter((label) => label !== chosen);
  const eachOther = (1 - probability) / others.length;
  return Object.fromEntries([
    [chosen, probability],
    ...others.map((label) => [label, eachOther] as const),
  ]);
}

/** Answers `doc-type` with the given label and confidence, and every flag with `flag`. */
export function answering(label = 'invoice', p = 0.99, flag = 0.01) {
  const answerOf = (question: Question): Answer => {
    if (question.type === 'choice') {
      const probabilities = distributionPeakingAt(question.criteria, label, p);
      return { type: 'choice', choice: label, probabilities };
    }
    if (question.type === 'boolean') return { type: 'boolean', probability: flag };
    return { type: 'score', score: 0, probabilities: { 0: 0.99 } };
  };
  return vi.fn<DoDecide>(async ({ questions }) => {
    const answers: Reply = {};
    for (const [id, question] of Object.entries(questions)) answers[id] = answerOf(question);
    return { answers, usage: { inputTokens: 100 }, warnings: [] };
  });
}

/** Answers every question with a boolean. */
export const answeredAll = (questions: Record<string, { type: string }>): Reply =>
  Object.fromEntries(
    Object.keys(questions).map((id) => [id, { type: 'boolean' as const, probability: 0.5 }]),
  );

/** A provider error with this status. */
export const apiError = (statusCode: number) =>
  new APICallError({
    message: 'no',
    url: 'u',
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

/** The facets most tests run. */
export const FACETS = ['doc-type', 'has-signature'];

/** Scans the library, to the end of the job. */
export async function scan() {
  const started = await callTool('scan', { path: root }, ctx);
  return waitForJob(started.id);
}

/** Organizes, to the end of the job. */
export async function organize(query = {}, facets: string[] = FACETS): Promise<Job> {
  const started = await callTool('organize', { query, facets }, ctx);
  return waitForJob(started.id);
}

/** The index id of a file in the library. */
export const fileId = (name: string) => ctx.db.fileByPath(at(name))!.id;

/** Gives each test in the file a temp home, a library in it, and a model that answers. */
export function setupOrganize(): void {
  vi.setConfig({ testTimeout: 30_000 }); // real workers, which a busy machine can hold up
  const home = useTempHome();
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
}

/** Saves over the bytes of an open file. `writeFile` would delete the tag stream on Windows. */
export async function saveInPlace(name: string, text: string) {
  const file = await open(at(name), 'r+');
  await file.truncate(0);
  await file.write(text, 0);
  await file.close();
}

/** Tags a file through the whole flow, then changes it, so the next run asks again. */
export async function organizedThenEdited(tags: string[] = []) {
  await writeFile(at('a.txt'), 'first');
  if (tags.length > 0) await writeTags(at('a.txt'), tags);
  await scan();
  const { plan_id: planId } = await organize();
  const applying = await callTool('apply_plan', { id: planId! }, ctx);
  await waitForJob(applying.id);
  await saveInPlace('a.txt', 'second');
  await scan();
}

/** Writes each file into the library, then scans them in. */
export async function scanned(files: Record<string, string | Buffer>) {
  for (const [name, content] of Object.entries(files)) await writeFile(at(name), content);
  return scan();
}

/** The mocked model call, as the spy `answering` made it. */
export const decideSpy = () => mock.doDecide as ReturnType<typeof answering>;

/** Everything the mocked model was sent, as one string to search. */
export const sentToModel = () => JSON.stringify(decideSpy().mock.calls);

/** Starts an organize run on the whole index, and returns at once with its job. */
export const startOrganize = () => callTool('organize', { query: {}, facets: FACETS }, ctx);

/** The operations of the plan a finished organize job stored. */
export async function planOps(job: Job) {
  const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
  return plan.ops;
}
