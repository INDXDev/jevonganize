import { writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Providers from '../src/ai/providers.ts';
import type * as Facets from '../src/core/facets.ts';
import { readTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import { at, ctx, idOf, scanned, setupToolContext } from './tools-helpers.ts';
import { modelMock, resetModelMock } from './tools-model-helpers.ts';

// The factories run before this file's imports settle, so they load the helpers themselves.
vi.mock('../src/core/facets.ts', async (original) => ({
  ...(await original<typeof Facets>()),
  loadCatalog: async () => (await import('./tools-model-helpers.ts')).CATALOG_TOPICS,
}));
vi.mock('../src/ai/providers.ts', async (original) =>
  (await import('./tools-model-helpers.ts')).mockedProviders(await original<typeof Providers>()),
);

setupToolContext();
beforeEach(resetModelMock);

/** Has the chat model report these proper names in every file. */
const reportNames = (names: { name: string; kind: string }[]) => {
  modelMock.chatReply = { names };
};

/** A contract that names an organization and a person, and mentions a file name. */
const CONTRACT = 'Contract between Acme Corp and 山田 太郎. See report.pdf.';

/** What the chat model reports for the contract: two real names, one invented, two file names. */
const CONTRACT_NAMES = [
  { name: 'Acme Corp', kind: 'organization' },
  { name: '山田 太郎', kind: 'person' },
  { name: 'Invented Inc', kind: 'organization' },
  { name: 'a.txt', kind: 'product' },
  { name: 'report.pdf', kind: 'product' },
];

/** The tags of the two names the contract does contain. */
const CONTRACT_TAGS = ['entity:organization/acme-corp', 'entity:person/山田-太郎'];

/** Runs organize on the language facet to its end, and returns the plan it made. */
async function organizeLanguage() {
  const input = { query: {}, facets: ['language'] };
  const job = await waitForJob((await callTool('organize', input, ctx)).id);
  return callTool('get_plan', { id: job.plan_id ?? '' }, ctx);
}

const applyPlan = async (id: string) => waitForJob((await callTool('apply_plan', { id }, ctx)).id);

/** Fills a.txt to `max_tags` with a tag a person added. */
async function fillWithOneTag() {
  ctx.config.max_tags = 1;
  const input = { file_ids: [idOf('a.txt')], add: ['status:draft'], title: 'fill' };
  await applyPlan((await callTool('propose_changes', input, ctx)).id);
}

describe('proper names in organize', () => {
  test('proposes only the names a gated file literally contains', async () => {
    await writeFile(at('a.txt'), CONTRACT);
    await scanned('b.txt');
    reportNames(CONTRACT_NAMES);
    const plan = await organizeLanguage();
    const contractOp = plan.ops.find((op) => op.file_id === idOf('a.txt'));
    expect(contractOp?.add).toEqual(CONTRACT_TAGS);
  });

  test('applying writes the name tags to disk, and undo removes them', async () => {
    await writeFile(at('a.txt'), CONTRACT);
    await scanned('b.txt');
    reportNames(CONTRACT_NAMES);
    const plan = await organizeLanguage();
    await applyPlan(plan.id);
    expect(await readTags(at('a.txt'))).toEqual(expect.arrayContaining(CONTRACT_TAGS));
    await waitForJob((await callTool('undo_plan', { id: plan.id }, ctx)).id);
    expect(await readTags(at('a.txt'))).toEqual([]);
  });

  test('a registered name joins the run, and is cleaned to the tag grammar', async () => {
    await scanned('a.txt');
    const value = 'organization/Acme Corp';
    await callTool('set_vocabulary', { facet: 'entity', value, state: 'active' }, ctx);
    expect(await callTool('list_vocabulary', { facet: 'entity' }, ctx)).toContainEqual(
      expect.objectContaining({ value: 'organization/acme-corp', state: 'active' }),
    );
    modelMock.oddsOf = (text) => (text.includes('acme-corp') ? 0.95 : 0.1);
    const plan = await organizeLanguage();
    expect(plan.ops[0]?.add).toContain('entity:organization/acme-corp');
  });

  test('a file the gate turns down never reaches the chat model', async () => {
    await scanned('a.txt');
    modelMock.oddsOf = () => 0.1;
    reportNames([{ name: 'text', kind: 'product' }]);
    const plan = await organizeLanguage();
    expect(modelMock.chatCalls).toBe(0);
    expect(plan.ops).toEqual([]);
  });

  test('a tag a person removed stays removed, and a full file still takes names', async () => {
    await scanned('a.txt');
    await fillWithOneTag();
    ctx.db.rejectTag(idOf('a.txt'), 'entity:product/text', 'no');
    reportNames([
      { name: 'text', kind: 'product' },
      { name: 'of', kind: 'place' },
      { name: 'a.txt', kind: 'project' },
    ]);
    const plan = await organizeLanguage();
    expect(plan.ops[0]?.add).toEqual(['entity:place/of']);
    const applied = await applyPlan(plan.id);
    expect(applied.status).toBe('done');
    expect(await readTags(at('a.txt'))).toContain('entity:place/of');
  });
});
