import { realpathSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm as remove,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Experimental_DecisionMockModelV4 as MockDecisionModel,
  MockLanguageModelV4,
} from 'ai/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import { paths, UserError } from '../src/core/config.ts';
import { readTags, writeTags } from '../src/core/tags.ts';
import {
  callTool,
  type Context,
  openContext,
  tools,
  waitForJob,
  watchLibraries,
} from '../src/core/tools.ts';
import type { Facet, ServerEvent, ToolName } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

const mock = vi.hoisted(() => ({ generate: undefined as unknown, probability: 0.9 }));

vi.mock('../src/ai/providers.ts', async (original) => {
  const real = await original<typeof Providers>();
  const caps = real.capabilities('openai', 'gpt-6-luna');
  return {
    ...real,
    resolveChatModel: async () => ({
      model: new MockLanguageModelV4({ doGenerate: mock.generate as never }),
      provider: 'openai',
      modelId: 'm',
      caps,
    }),
    resolveModel: async () => ({
      model: new MockDecisionModel({
        doDecide: async ({ questions }) => ({
          answers: Object.fromEntries(
            Object.keys(questions).map((id) => [
              id,
              { type: 'boolean' as const, probability: mock.probability },
            ]),
          ),
          usage: { inputTokens: 1 },
          warnings: [],
        }),
      }),
      provider: 'openai',
      modelId: 'm',
      caps,
    }),
  };
});

vi.setConfig({ testTimeout: 30_000 }); // real workers, which a busy machine can hold up

const home = useTempHome();
let ctx: Context;
let root: string;
let events: ServerEvent[];

const at = (name: string) => join(root, name);
const as = (caller: Context['caller'], approved?: boolean): Context => ({
  ...ctx,
  caller,
  approved,
});

async function scanned(...names: string[]) {
  for (const name of names) await writeFile(at(name), `text of ${name}`);
  await waitForJob((await callTool('scan', {}, ctx)).id);
}

const idOf = (name: string) => ctx.db.fileByPath(at(name))!.id;

beforeEach(async () => {
  root = join(home(), 'library');
  await mkdir(root);
  events = [];
  ctx = await openContext('cli', (event) => events.push(event));
  await callTool('add_library', { path: root }, ctx);
});

afterEach(() => {
  vi.restoreAllMocks();
  ctx.db.close();
});

const filesEvents = () => events.filter((event) => event.type === 'files');

describe('the approval gate on what only a person may drop', () => {
  test('a model cannot resolve review items, and a person can', async () => {
    await scanned('a.txt');
    addReview('lost', 'restore');
    const input = { ids: ids(), accept: false };
    await expect(callTool('resolve_reviews', input, as('chat'))).rejects.toThrow('approve');
    await expect(callTool('resolve_reviews', input, as('mcp'))).rejects.toThrow('approve');
    expect(ids()).toHaveLength(1);
    await callTool('resolve_reviews', input, as('ui'));
    expect(ids()).toEqual([]);
  });

  test('a model cannot discard a plan, and a person can', async () => {
    await scanned('a.txt');
    const input = { file_ids: [idOf('a.txt')], add: ['x'], title: 't' };
    const { id } = await callTool('propose_changes', input, ctx);
    await expect(callTool('discard_plan', { id }, as('mcp'))).rejects.toThrow('approve');
    await callTool('discard_plan', { id }, as('cli'));
    expect(ctx.db.getPlan(id)).toBeUndefined();
  });
});

describe('applying a plan twice at once', () => {
  test('one call gets it, so undo keeps every op', async () => {
    await scanned('a.txt', 'b.txt');
    const input = { query: { folder: root }, add: ['x'], title: 't' };
    const { id } = await callTool('propose_changes', input, ctx);
    const calls = await Promise.allSettled([
      callTool('apply_plan', { id }, ctx),
      callTool('apply_plan', { id }, ctx),
    ]);
    const started = calls.flatMap((call) => (call.status === 'fulfilled' ? [call.value] : []));
    expect(started).toHaveLength(1);
    await waitForJob(started[0]!.id);
    expect((await callTool('get_plan', { id }, ctx)).ops).toHaveLength(2);
  });

  test('a plan part-way through a crash cannot be discarded, so its undo survives', async () => {
    await scanned('a.txt');
    const input = { file_ids: [idOf('a.txt')], add: ['x'], title: 't' };
    const { id } = await callTool('propose_changes', input, ctx);
    ctx.db.addPlanOp(id, { file_id: idOf('a.txt'), add: ['x'], remove: [] });
    await expect(callTool('discard_plan', { id }, ctx)).rejects.toThrow('Apply it');
  });

  test('list_plans brings back a plan whose apply died', async () => {
    await scanned('a.txt');
    const input = { file_ids: [idOf('a.txt')], add: ['x'], title: 't' };
    const { id } = await callTool('propose_changes', input, ctx);
    ctx.db.claimPlan(id, 1);
    expect(await callTool('list_plans', { status: 'proposed' }, ctx)).toMatchObject([{ id }]);
  });
});

// A short 8.3 name on the Windows runner, and a symlink on macOS. A plain path on Linux has neither.
describe.runIf(tmpdir() !== realpathSync.native(tmpdir()))(
  'a path that is not the real path',
  () => {
    test('finds the same library and file as the real path', async () => {
      const alias = await mkdtemp(join(tmpdir(), 'jevonganize-alias-'));
      const real = realpathSync.native(alias);
      try {
        await writeFile(join(alias, 'a.txt'), 'x');
        expect((await callTool('add_library', { path: alias }, ctx)).path).toBe(real);
        await waitForJob((await callTool('scan', { path: alias }, ctx)).id);
        const file = await callTool('get_file', { path: join(alias, 'a.txt') }, ctx);
        expect(file.path).toBe(join(real, 'a.txt'));
        await callTool('remove_library', { path: alias }, ctx);
        expect(ctx.db.fileByPath(join(real, 'a.txt'))).toBeUndefined();
      } finally {
        await remove(real, { recursive: true, force: true });
      }
    });
  },
);

describe('symlinked libraries', () => {
  test('a link to a secret folder is refused', async () => {
    const secret = join(home(), '.aws');
    await mkdir(secret);
    await writeFile(join(secret, 'credentials'), 'key');
    const link = join(home(), 'innocent');
    await symlink(secret, link);
    await expect(callTool('add_library', { path: link }, ctx)).rejects.toThrow('excluded');
    expect(ctx.db.listLibraries().map(({ path }) => path)).toEqual([root]);
  });

  test('another link is stored by its real path, so exclusions see where it leads', async () => {
    const real = join(home(), 'real');
    await mkdir(real);
    const link = join(home(), 'link');
    await symlink(real, link);
    const { path } = await callTool('add_library', { path: link }, ctx);
    expect(path).toBe(await realpath(real));
  });
});

describe('index upkeep', () => {
  test('a scan refreshes the numbers once, and similarity can read them', async () => {
    const refresh = vi.spyOn(ctx.db, 'refreshIdf');
    await writeFile(at('a.txt'), 'a');
    await writeTags(at('a.txt'), ['t']);
    await scanned('b.txt');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ctx.db.fileById(idOf('a.txt'))?.tag_w).toBeGreaterThan(0);
  });

  test('watch events share one refresh and one files event', async () => {
    const refresh = vi.spyOn(ctx.db, 'refreshIdf');
    const stop = watchLibraries(ctx);
    try {
      await vi.waitFor(() => expect(ctx.db.listLibraries()[0]?.scanned_at).toBeTruthy());
      for (const name of ['a.txt', 'b.txt', 'c.txt']) {
        await writeFile(at(name), name);
        await new Promise((done) => setTimeout(done, 400));
      }
      await vi.waitFor(() => expect(filesEvents()).not.toEqual([]), {
        timeout: 9000,
        interval: 50,
      });
    } finally {
      await stop();
    }
    expect(filesEvents()).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(filesEvents()[0]).toMatchObject({
      ids: expect.arrayContaining([idOf('a.txt'), idOf('c.txt')]),
    });
  });

  test('cleanup_report stays quick at 3,000 tags', async () => {
    await scanned('a.txt');
    const names = Array.from({ length: 3000 }, (_, n) => `topic:label-${n}`);
    ctx.db.addFileTags(idOf('a.txt'), names, false);
    const started = performance.now();
    const report = await callTool('cleanup_report', {}, ctx);
    expect(performance.now() - started).toBeLessThan(2500); // under coverage, on a busy machine
    expect(report.single_use).toHaveLength(3000);
  });

  test('search_files has a default page for every caller, and a person can ask for more', async () => {
    ctx.db.transaction(() => {
      for (let n = 0; n < 60; n++) {
        const file = { path: at(`f${n}`), dev: '1', ino: String(n), size: 1 };
        ctx.db.upsertFile({ ...file, mtime_ns: '1', ctime_ns: '1' }, { edited: false });
      }
    });
    expect(await callTool('search_files', {}, ctx)).toMatchObject({ total: 60 });
    expect((await callTool('search_files', {}, ctx)).files).toHaveLength(50);
    expect((await callTool('search_files', { limit: 60 }, ctx)).files).toHaveLength(60);
  });
});

/** Reads the table out of the contract, so code and document cannot drift. */
async function contract() {
  const text = await readFile(new URL('../docs/contracts.md', import.meta.url), 'utf8');
  const rows = [...text.matchAll(/^\| `(\w+)` \|.*\| (.+?) \| (yes|no|yes, with approval) \|$/gm)];
  return rows.map(([, name = '', writes = '', agent = '']) => ({
    name: name as ToolName,
    writes: writes !== 'no',
    agent: agent !== 'no',
    approval: agent === 'yes, with approval',
  }));
}

const addReview = (tag: string, kind: 'suggest' | 'restore' = 'suggest') =>
  ctx.db.addReview({ file_id: idOf('a.txt'), kind, tag, confidence: 0.6, reason: 'r' });
const ids = () => ctx.db.listReviews().map((item) => item.id);

const reply = (tags: string[]) => ({
  content: [{ type: 'text', text: JSON.stringify({ tags }) }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
});

describe('the table', () => {
  test('matches docs/contracts.md row by row, with no tool missing or extra', async () => {
    const rows = await contract();
    expect(rows.map((row) => row.name).toSorted()).toEqual(Object.keys(tools).toSorted());
    for (const { name, writes, agent, approval } of rows) {
      const tool = tools[name];
      expect({
        name,
        writes: tool.writes,
        agent: tool.agent,
        approval: 'approval' in tool,
      }).toEqual({
        name,
        writes,
        agent,
        approval,
      });
    }
  });

  test('no key, config or folder tool is offered to a model', () => {
    for (const name of ['set_api_key', 'get_config', 'set_config', 'add_library'] as const) {
      expect(tools[name].agent).toBe(false);
    }
  });
});

describe('entry point', () => {
  test('validates with the schema, naming the tool, as a UserError', async () => {
    const bad = callTool('similar_files', { id: 'x' } as never, ctx);
    await expect(bad).rejects.toThrow(UserError);
    await expect(bad).rejects.toThrow('similar_files');
    await expect(callTool('status', { extra: 1 } as never, ctx)).rejects.toThrow('unknown key');
  });

  test('a model caller cannot reach agent: false, nor approval tools without approval', async () => {
    await scanned('a.txt');
    const plan = await callTool(
      'propose_changes',
      { file_ids: [idOf('a.txt')], add: ['x'], title: 't' },
      ctx,
    );
    for (const caller of ['chat', 'mcp'] as const) {
      await expect(callTool('get_config', {}, as(caller))).rejects.toThrow('not offered');
      await expect(callTool('apply_plan', { id: plan.id }, as(caller))).rejects.toThrow('approve');
    }
    expect(await readTags(at('a.txt'))).toEqual([]);
    const job = await callTool('apply_plan', { id: plan.id }, as('mcp', true));
    await waitForJob(job.id);
    expect(await readTags(at('a.txt'))).toEqual(['x']);
  });

  test.each([
    ['cli', 'user'],
    ['ui', 'user'],
    ['chat', 'chat'],
    ['mcp', 'mcp'],
  ] as const)('caller %s sets Plan.source to %s', async (caller, source) => {
    await scanned('a.txt');
    const input = { file_ids: [idOf('a.txt')], add: ['x'], title: 't' };
    expect((await callTool('propose_changes', input, as(caller))).source).toBe(source);
    expect((await callTool('rename_tag', { from: 'x', to: 'y' }, as(caller))).source).toBe(source);
  });
});

describe('libraries and browsing', () => {
  test('adds, lists and removes, and removing leaves tags on the files', async () => {
    await scanned('a.txt');
    await writeTags(at('a.txt'), ['keep']);
    expect(await callTool('list_libraries', {}, ctx)).toMatchObject([
      { path: root, files: 1, taggable: true },
    ]);
    await callTool('remove_library', { path: root }, ctx);
    expect(await callTool('list_libraries', {}, ctx)).toEqual([]);
    expect(await readTags(at('a.txt'))).toEqual(['keep']);
  });

  test('refuses a path that is not a folder', async () => {
    await expect(callTool('add_library', { path: at('none') }, ctx)).rejects.toThrow(
      'not a folder',
    );
  });

  test('browse lists visible child folders and the parent', async () => {
    await mkdir(at('b'));
    await mkdir(at('a'));
    await mkdir(at('.hidden'));
    await writeFile(at('f.txt'), '');
    const result = await callTool('browse_dirs', { path: root }, ctx);
    expect(result).toEqual({ path: root, parent: home(), dirs: ['a', 'b'] });
    await expect(callTool('browse_dirs', { path: at('none') }, ctx)).rejects.toThrow(UserError);
  });

  test('scan refuses a path outside a library, so a model cannot widen its reach', async () => {
    await expect(callTool('scan', { path: home() }, as('mcp'))).rejects.toThrow('not a library');
  });

  test('scan reports counts and warnings on the job, and files by event', async () => {
    await scanned('a.txt');
    const { scan, warnings } = await waitForJob((await callTool('scan', {}, ctx)).id);
    expect(scan).toMatchObject({ files: 1, added: 0 });
    expect(warnings).toEqual([]);
    expect(events).toContainEqual({ type: 'files', ids: [idOf('a.txt')] });
  });

  test('scanning all goes past an unplugged library, and warns', async () => {
    await scanned('a.txt');
    const second = at('drive');
    await mkdir(second);
    await callTool('add_library', { path: second }, ctx);
    const { rm } = await import('node:fs/promises');
    await rm(second, { recursive: true });
    const job = await waitForJob((await callTool('scan', {}, ctx)).id);
    expect(job.status).toBe('done');
    expect(job.warnings?.join()).toContain('drive');
    const named = await waitForJob((await callTool('scan', { path: second }, ctx)).id);
    expect(named.status).toBe('failed');
  });

  test('a scan leaves facet weights on tags, so similarity can read them', async () => {
    await writeFile(at('a.txt'), 'x');
    await writeTags(at('a.txt'), ['has-pii', 'flag:has-pii', 'language:en']);
    await waitForJob((await callTool('scan', {}, ctx)).id);
    const tags = await callTool('list_tags', { facet: 'has-pii' }, ctx);
    expect(tags).toMatchObject([{ tag: 'flag:has-pii', facet: 'has-pii' }]);
  });
});

describe('files', () => {
  test('search caps what a model gets, and leaves a person’s limit alone', async () => {
    await scanned(...Array.from({ length: 60 }, (_, index) => `${index}.txt`));
    expect((await callTool('search_files', { limit: 9999 }, ctx)).files).toHaveLength(60);
    expect((await callTool('search_files', {}, as('mcp'))).files).toHaveLength(50);
    expect((await callTool('search_files', { limit: 9999 }, as('mcp'))).files).toHaveLength(60);
  });

  test('get_file finds by id or path, and says how to fix a miss', async () => {
    await scanned('a.txt');
    const byPath = await callTool('get_file', { path: at('a.txt') }, ctx);
    expect(byPath).toMatchObject({ name: 'a.txt', taggable: true });
    expect((await callTool('get_file', { id: byPath.id }, ctx)).path).toBe(at('a.txt'));
    await expect(callTool('get_file', { path: at('b.txt') }, ctx)).rejects.toThrow(
      'jevonganize scan',
    );
    await expect(callTool('get_file', {}, ctx)).rejects.toThrow('id or a path');
  });

  test('similar_files and status read the index', async () => {
    await writeFile(at('a.txt'), 'a');
    await writeFile(at('b.txt'), 'b');
    await writeTags(at('a.txt'), ['t']);
    await writeTags(at('b.txt'), ['t']);
    await waitForJob((await callTool('scan', {}, ctx)).id);
    const similar = await callTool('similar_files', { id: idOf('a.txt') }, ctx);
    expect(similar.map((file) => file.name)).toEqual(['b.txt']);
    const status = await callTool('status', {}, ctx);
    expect(status).toMatchObject({ files: 2, tags: 1, provider: 'openai', has_key: false });
  });
});

describe('facets', () => {
  const custom: Facet = {
    id: 'seen',
    pack: 'mine',
    title: 'Seen',
    kind: 'flag',
    instructions: 'Q?',
    applies_to: [],
    weight: 1,
  };

  test('saves, lists as custom, and deletes a custom facet', async () => {
    await callTool('save_facet', custom, ctx);
    const listed = (await callTool('list_facets', {}, ctx)).find((facet) => facet.id === 'seen');
    expect(listed).toMatchObject({ custom: true, enabled: false, pack: 'mine' });
    await callTool('delete_facet', { id: 'seen' }, ctx);
    expect((await callTool('list_facets', {}, ctx)).some((facet) => facet.id === 'seen')).toBe(
      false,
    );
  });

  test('refuses an invalid facet, and deleting a preset', async () => {
    await expect(callTool('save_facet', { ...custom, id: 'Bad Id' }, ctx)).rejects.toThrow(
      UserError,
    );
    await expect(callTool('delete_facet', { id: 'doc-type' }, ctx)).rejects.toThrow('not a custom');
    await expect(callTool('delete_facet', { id: '../x' }, ctx)).rejects.toThrow(UserError);
  });

  test('set_enabled turns packs and facets on and off, and saves the choice', async () => {
    const enabled = async (id: string) =>
      (await callTool('list_facets', {}, ctx)).find((facet) => facet.id === id)?.enabled;
    expect(await enabled('invoice-state')).toBe(false);
    await callTool('set_enabled', { ids: ['finance'], enabled: true }, ctx);
    expect(await enabled('invoice-state')).toBe(true);
    await callTool('set_enabled', { ids: ['invoice-state'], enabled: false }, ctx);
    expect(await enabled('invoice-state')).toBe(false);
    expect(await enabled('amount')).toBe(true);
    expect(await readFile(paths.configFile(), 'utf8')).toContain('invoice-state');
    await expect(callTool('set_enabled', { ids: ['nope'], enabled: true }, ctx)).rejects.toThrow(
      'no facet',
    );
  });
});

describe('plans', () => {
  test('apply takes only an id, and refuses a plan twice or a wrong status', async () => {
    await scanned('a.txt');
    const plan = await callTool(
      'propose_changes',
      { file_ids: [idOf('a.txt')], add: ['x'], title: 't' },
      ctx,
    );
    await expect(callTool('apply_plan', { id: plan.id, ops: [] } as never, ctx)).rejects.toThrow(
      'unknown key',
    );
    await expect(callTool('undo_plan', { id: plan.id }, ctx)).rejects.toThrow('proposed');
    const job = await callTool('apply_plan', { id: plan.id }, ctx);
    await expect(callTool('apply_plan', { id: plan.id }, ctx)).rejects.toThrow(/is appl(y|ied)/);
    expect(await waitForJob(job.id)).toMatchObject({ status: 'done', plan_id: plan.id });
    await expect(callTool('apply_plan', { id: plan.id }, ctx)).rejects.toThrow('applied');
    await expect(callTool('discard_plan', { id: plan.id }, ctx)).rejects.toThrow('stays');
    await expect(callTool('get_plan', { id: 'none' }, ctx)).rejects.toThrow('no plan');
  });

  test('discard drops a proposed plan, and the list hides ops', async () => {
    await scanned('a.txt');
    const plan = await callTool(
      'propose_changes',
      { file_ids: [idOf('a.txt')], add: ['x'], title: 't' },
      ctx,
    );
    expect(await callTool('list_plans', { status: 'proposed' }, ctx)).toMatchObject([
      { id: plan.id, ops: [] },
    ]);
    await callTool('discard_plan', { id: plan.id }, ctx);
    expect(await callTool('list_plans', {}, ctx)).toEqual([]);
  });

  test('cancel_job refuses a job that does not exist', async () => {
    await expect(callTool('cancel_job', { id: 'x' }, ctx)).rejects.toThrow('no job');
    await expect(waitForJob('x')).rejects.toThrow('no job');
  });
});

describe('reviews', () => {
  test('accepting builds a plan and writes nothing, and open vocabulary is activated', async () => {
    await scanned('a.txt');
    addReview('project:acme');
    const plan = await callTool('resolve_reviews', { ids: ids(), accept: true }, ctx);
    expect(plan).toMatchObject({ status: 'proposed', summary: { added: { 'project:acme': 1 } } });
    expect(await readTags(at('a.txt'))).toEqual([]);
    expect(ctx.db.listVocabulary('project')).toMatchObject([{ value: 'acme', state: 'active' }]);
    expect(await callTool('list_reviews', {}, ctx)).toEqual([]);
    expect(events).toContainEqual({ type: 'reviews', count: 0 });
  });

  test('rejecting returns null: a suggest stays rejected, a restore is deleted', async () => {
    await scanned('a.txt');
    addReview('topic:a');
    addReview('old', 'restore');
    expect(await callTool('resolve_reviews', { ids: ids(), accept: false }, ctx)).toBeNull();
    expect(ctx.db.rejectedTags(idOf('a.txt'))).toEqual(['topic:a']);
    expect(ctx.db.reviewsByIds([1, 2, 3]).map((item) => item.tag)).toEqual(['topic:a']);
  });

  test('a settled item cannot be accepted afterwards', async () => {
    await scanned('a.txt');
    addReview('topic:a');
    const [id = 0] = ids();
    await callTool('resolve_reviews', { ids: [id], accept: false }, ctx);
    expect(await callTool('resolve_reviews', { ids: [id], accept: true }, ctx)).toBeNull();
  });

  test('set_vocabulary takes open facets only', async () => {
    await callTool('set_vocabulary', { facet: 'topic', value: 'tax', state: 'retired' }, ctx);
    expect(ctx.db.listVocabulary('topic')).toMatchObject([{ value: 'tax', state: 'retired' }]);
    await expect(
      callTool('set_vocabulary', { facet: 'doc-type', value: 'x', state: 'active' }, ctx),
    ).rejects.toThrow('not an open facet');
  });
});

describe('suggest_tags', () => {
  test('verified suggestions become review items, never tags', async () => {
    await scanned('a.txt');
    mock.probability = 0.9;
    mock.generate = reply(['topic:garden', 'evil:x']);
    const items = await callTool('suggest_tags', { id: idOf('a.txt') }, ctx);
    expect(items).toMatchObject([{ tag: 'topic:garden', kind: 'suggest', confidence: null }]);
    expect(await readTags(at('a.txt'))).toEqual([]);
    expect(ctx.db.listVocabulary('topic')).toMatchObject([{ value: 'garden', state: 'proposed' }]);
  });

  test('the verifier drops what it does not back, and a rejected tag stays out', async () => {
    await scanned('a.txt');
    mock.generate = reply(['topic:garden']);
    mock.probability = 0.1;
    expect(await callTool('suggest_tags', { id: idOf('a.txt') }, ctx)).toEqual([]);
    mock.probability = 0.9;
    ctx.db.rejectTag(idOf('a.txt'), 'topic:garden', 'no');
    expect(await callTool('suggest_tags', { id: idOf('a.txt') }, ctx)).toEqual([]);
  });

  test('refuses a file now excluded', async () => {
    await scanned('a.txt');
    ctx.config.exclude.push('a.txt');
    await expect(callTool('suggest_tags', { id: idOf('a.txt') }, ctx)).rejects.toThrow(
      'not in a library',
    );
  });
});

describe('reports and config', () => {
  test('cleanup finds near-duplicates, one-file tags and over-broad tags', async () => {
    const names = Array.from({ length: 10 }, (_, index) => `${index}.txt`);
    for (const name of names) {
      await writeFile(at(name), name);
      await writeTags(at(name), ['doc-type:document']);
    }
    await writeTags(at('0.txt'), ['doc-type:document', 'project:acme', 'project:acme-corp']);
    await waitForJob((await callTool('scan', {}, ctx)).id);
    const report = await callTool('cleanup_report', {}, ctx);
    expect(report.near_duplicates).toEqual([
      { tags: ['project:acme', 'project:acme-corp'], files: 2 },
    ]);
    expect(report.single_use.map((row) => row.tag)).toEqual(['project:acme', 'project:acme-corp']);
    expect(report.over_broad.map((row) => row.tag)).toEqual(['doc-type:document']);
  });

  test('doctor fails with no key, and reports volumes', async () => {
    const checks = await callTool('doctor', {}, ctx);
    expect(checks.find((check) => check.name === 'key')).toMatchObject({ ok: false });
    expect(checks.find((check) => check.name === 'volume')).toMatchObject({ ok: true });
    expect(checks.filter((check) => check.name.startsWith('optional:')).every((c) => c.ok)).toBe(
      true,
    );
    await callTool('set_api_key', { provider: 'openai', key: 'k' }, ctx);
    expect((await callTool('doctor', {}, ctx)).find((check) => check.name === 'key')).toMatchObject(
      {
        ok: true,
        detail: 'openai key present (file)',
      },
    );
  });

  test('set_config validates, saves and reaches the running context', async () => {
    await callTool('set_config', { thresholds: { apply: 0.9 } }, ctx);
    expect(ctx.config.thresholds.apply).toBe(0.9);
    await expect(callTool('set_config', { nope: 1 }, ctx)).rejects.toThrow('unknown key');
    const { config, schema } = await callTool('get_config', {}, ctx);
    expect(config.thresholds).toMatchObject({ apply: 0.9 });
    expect(schema).toHaveProperty('properties');
  });

  test('reveal_file refuses an id it cannot serve, and never takes a path', async () => {
    await expect(callTool('reveal_file', { id: 999 }, ctx)).rejects.toThrow('not in a library');
    await expect(callTool('reveal_file', { path: '/x' } as never, ctx)).rejects.toThrow(UserError);
  });
});
