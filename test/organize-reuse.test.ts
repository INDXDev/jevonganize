import {
  at,
  ctx,
  FACETS,
  fileId,
  mock,
  organize,
  scan,
  setupOrganize,
} from './organize-helpers.ts';
import { rename, writeFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { callTool, waitForJob } from '../src/core/tools.ts';

setupOrganize();

const EDITED_NOTE = 'A longer note about something else entirely';

const decideCalls = () => vi.mocked(mock.doDecide as () => void).mock.calls.length;

/** Runs organize, and says how many files it read and how many times it asked. */
async function organizeCounted(facets = FACETS) {
  const readBefore = mock.states.length;
  const askedBefore = decideCalls();
  const job = await organize({}, facets);
  return { job, read: mock.states.length - readBefore, asked: decideCalls() - askedBefore };
}

/** Indexes `a.txt`, without organizing it. */
async function scanInvoice() {
  await writeFile(at('a.txt'), 'Invoice 44 for Acme');
  await scan();
}

/** Indexes `a.txt` and organizes it once, so a later run has something to reuse. */
async function organizeInvoice() {
  await scanInvoice();
  return organizeCounted();
}

describe('a file with nothing new to read', () => {
  test('is planned from the index, the same as if it had been read', async () => {
    const first = await organizeInvoice();
    expect(first).toMatchObject({ read: 1, asked: 1 });
    const before = ctx.db.fileById(fileId('a.txt'))!;
    const firstPlan = await callTool('get_plan', { id: first.job.plan_id! }, ctx);

    const second = await organizeCounted();
    expect(second).toMatchObject({ read: 0, asked: 0 });
    expect(second.job).toMatchObject({ status: 'done', done: 1, failed: 0 });
    const secondPlan = await callTool('get_plan', { id: second.job.plan_id! }, ctx);
    expect(secondPlan.summary).toEqual(firstPlan.summary);
    expect(ctx.db.fileById(fileId('a.txt'))).toEqual(before);
  });

  test('is planned again after its tags are written, which moves its ctime', async () => {
    const { job } = await organizeInvoice();
    await waitForJob((await callTool('apply_plan', { id: job.plan_id! }, ctx)).id);
    expect(await organizeCounted()).toMatchObject({ read: 0, asked: 0 });
  });

  test('is never read or planned once a rule excludes it', async () => {
    await organizeInvoice();
    await callTool('set_config', { exclude: ['a.txt'] }, ctx);
    const { job, read } = await organizeCounted();
    expect(read).toBe(0);
    expect(job.warnings?.join()).toContain('excluded');
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.files).toBe(0);
  });
});

describe('a file whose inputs changed', () => {
  test('is read when its content changed', async () => {
    await organizeInvoice();
    await writeFile(at('a.txt'), EDITED_NOTE);
    await scan();
    expect((await organizeCounted()).read).toBe(1);
  });

  test('is read when it was edited behind the index', async () => {
    await organizeInvoice();
    await writeFile(at('a.txt'), EDITED_NOTE);
    expect((await organizeCounted()).read).toBe(1);
  });

  test('is read under a new name, which is part of what a model sees', async () => {
    await organizeInvoice();
    await rename(at('a.txt'), at('b.txt'));
    await scan();
    expect(await organizeCounted()).toMatchObject({ read: 1, asked: 1 });
  });

  test.each([
    ['budget', { budget: { text_chars: 10 } }],
    ['send_images', { send_images: false }],
  ])('is read when %s changes', async (_name, change) => {
    await organizeInvoice();
    await callTool('set_config', change, ctx);
    expect((await organizeCounted()).read).toBe(1);
  });

  test('is read when PATH, which picks the tools, changes', async () => {
    await organizeInvoice();
    vi.stubEnv('PATH', `${process.env.PATH}:/nonexistent`);
    expect((await organizeCounted()).read).toBe(1);
    vi.unstubAllEnvs();
  });
});

describe('a file whose stored results fall short', () => {
  test('is read when a facet has no cached answer yet', async () => {
    await scanInvoice();
    await organizeCounted(['has-signature']); // does not apply to text, so doc-type has no answer
    expect(await organizeCounted(FACETS)).toMatchObject({ read: 1, asked: 1 });
  });

  test('is read when a cached answer fails its check', async () => {
    await organizeInvoice();
    const getAnswer = vi
      .spyOn(ctx.db, 'getAnswer')
      .mockReturnValueOnce([
        { facet: 'doc-type', question: 'doc-type', value: 'not-a-label', confidence: 1 } as never,
      ]);
    expect((await organizeCounted()).read).toBe(1);
    getAnswer.mockRestore();
  });

  test('is read when the searchable text is gone', async () => {
    await organizeInvoice();
    const getContent = vi.spyOn(ctx.db, 'getContent').mockReturnValueOnce(undefined);
    expect((await organizeCounted()).read).toBe(1);
    getContent.mockRestore();
  });
});

describe('what a cancelled or finished run stored', () => {
  test('keeps the text and links of every file, past one commit', async () => {
    const names = Array.from({ length: 70 }, (_, n) => `f${n}.txt`);
    await Promise.all(names.map((name) => writeFile(at(name), `Note ${name}`)));
    await scan();
    await organize();
    for (const name of names) {
      expect(ctx.db.getContent(fileId(name))).toBe(`Note ${name}`);
      expect(ctx.db.fileAnswers(fileId(name)).length).toBeGreaterThan(0);
    }
  });
});
