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

/** Runs organize, and says how many files it read and how many times it asked. */
async function run(facets = FACETS) {
  const read = mock.states.length;
  const asked = vi.mocked(mock.doDecide as () => void).mock.calls.length;
  const job = await organize({}, facets);
  return {
    job,
    read: mock.states.length - read,
    asked: vi.mocked(mock.doDecide as () => void).mock.calls.length - asked,
  };
}

async function organized() {
  await writeFile(at('a.txt'), 'Invoice 44 for Acme');
  await scan();
  return run();
}

describe('a file with nothing new to read', () => {
  test('is planned from the index, the same as if it had been read', async () => {
    const first = await organized();
    expect(first).toMatchObject({ read: 1, asked: 1 });
    const before = ctx.db.fileById(fileId('a.txt'))!;
    const plan = await callTool('get_plan', { id: first.job.plan_id! }, ctx);

    const second = await run();
    expect(second).toMatchObject({ read: 0, asked: 0 });
    expect(second.job).toMatchObject({ status: 'done', done: 1, failed: 0 });
    const again = await callTool('get_plan', { id: second.job.plan_id! }, ctx);
    expect(again.summary).toEqual(plan.summary);
    expect(ctx.db.fileById(fileId('a.txt'))).toEqual(before);
  });

  test('is planned again after its tags are written, which moves its ctime', async () => {
    const { job } = await organized();
    await waitForJob((await callTool('apply_plan', { id: job.plan_id! }, ctx)).id);
    expect(await run()).toMatchObject({ read: 0, asked: 0 });
  });

  test('is read when its content changed', async () => {
    await organized();
    await writeFile(at('a.txt'), 'A longer note about something else entirely');
    await scan();
    expect((await run()).read).toBe(1);
  });

  test('is read when it was edited behind the index', async () => {
    await organized();
    await writeFile(at('a.txt'), 'A longer note about something else entirely');
    expect((await run()).read).toBe(1);
  });

  test('is read under a new name, which is part of what a model sees', async () => {
    await organized();
    await rename(at('a.txt'), at('b.txt'));
    await scan();
    expect(await run()).toMatchObject({ read: 1, asked: 1 });
  });

  test.each([
    ['budget', { budget: { text_chars: 10 } }],
    ['send_images', { send_images: false }],
  ])('is read when %s changes', async (_name, change) => {
    await organized();
    await callTool('set_config', change, ctx);
    expect((await run()).read).toBe(1);
  });

  test('is read when PATH, which picks the tools, changes', async () => {
    await organized();
    vi.stubEnv('PATH', `${process.env.PATH}:/nonexistent`);
    expect((await run()).read).toBe(1);
    vi.unstubAllEnvs();
  });

  test('is read when a facet has no cached answer yet', async () => {
    await writeFile(at('a.txt'), 'Invoice 44 for Acme');
    await scan();
    await run(['has-signature']); // does not apply to text, so doc-type has no answer
    expect(await run(FACETS)).toMatchObject({ read: 1, asked: 1 });
  });

  test('is read when a cached answer fails its check', async () => {
    await organized();
    const getAnswer = vi
      .spyOn(ctx.db, 'getAnswer')
      .mockReturnValueOnce([
        { facet: 'doc-type', question: 'doc-type', value: 'not-a-label', confidence: 1 } as never,
      ]);
    expect((await run()).read).toBe(1);
    getAnswer.mockRestore();
  });

  test('is read when the searchable text is gone', async () => {
    await organized();
    const getContent = vi.spyOn(ctx.db, 'getContent').mockReturnValueOnce(undefined);
    expect((await run()).read).toBe(1);
    getContent.mockRestore();
  });

  test('is never read or planned once a rule excludes it', async () => {
    await organized();
    await callTool('set_config', { exclude: ['a.txt'] }, ctx);
    const { job, read } = await run();
    expect(read).toBe(0);
    expect(job.warnings?.join()).toContain('excluded');
    const plan = await callTool('get_plan', { id: job.plan_id! }, ctx);
    expect(plan.summary.files).toBe(0);
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
