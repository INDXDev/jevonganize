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
      if (mock.noKey) throw new (await import('../src/core/config.ts')).UserError('no key');
      mock.profiles.push(profile);
      const caps = { ...real.capabilities('openai', 'gpt-6-luna'), native: mock.native };
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

/** A complete distribution, as the SDK requires. */
function spread(criteria: object, label: string, p: number) {
  const rest = Object.keys(criteria).filter((key) => key !== label);
  return Object.fromEntries([
    [label, p],
    ...rest.map((key) => [key, (1 - p) / rest.length] as const),
  ]);
}

/** Answers `doc-type` with the given label and confidence, and every flag with `flag`. */
export function answering(label = 'invoice', p = 0.99, flag = 0.01) {
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
  return waitForJob((await callTool('scan', { path: root }, ctx)).id);
}

/** Organizes, to the end of the job. */
export async function organize(query = {}, facets: string[] = FACETS): Promise<Job> {
  return waitForJob((await callTool('organize', { query, facets }, ctx)).id);
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
  const { plan_id: id } = await organize();
  await waitForJob((await callTool('apply_plan', { id: id! }, ctx)).id);
  await saveInPlace('a.txt', 'second');
  await scan();
}
