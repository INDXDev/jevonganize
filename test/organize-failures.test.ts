import {
  answering,
  apiError,
  at,
  ctx,
  type DoDecide,
  mock,
  organize,
  planOps,
  scanned,
  sentToModel,
  setupOrganize,
  startOrganize,
} from './organize-helpers.ts';
import { rm, writeFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { callTool } from '../src/core/tools.ts';

setupOrganize();

/** A PDF of 2 MiB, past a parse budget of 1 MB. */
const PDF_OVER_ONE_MB = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 ** 21)]);

/** The stat fields an index row needs, for a file the scan never saw. */
const FAKE_STAT = { dev: '1', ino: '1', size: 9, mtime_ns: '1', ctime_ns: '1' };

describe('what is never sent', () => {
  test('a row for an excluded file is skipped, even if the scan predates the rule', async () => {
    await scanned({ 'a.txt': 'public', 'b.txt': 'hidden' });
    ctx.config.exclude.push('b.txt');

    const job = await organize();

    expect(job.warnings?.join()).toContain('excluded');
    expect(sentToModel()).toContain('public');
    expect(sentToModel()).not.toContain('hidden');
  });

  test('a secret that reached the index is not read, whatever the config says', async () => {
    await scanned({ 'a.txt': 'x' });
    const secret = at('.env');
    await writeFile(secret, 'TOKEN=abc');
    ctx.db.upsertFile({ path: secret, ...FAKE_STAT }, { edited: false });

    const job = await organize();

    expect(job.done).toBe(2);
    expect(sentToModel()).not.toContain('TOKEN');
    expect(ctx.db.getContent(ctx.db.fileByPath(secret)!.id)).toBeUndefined();
  });
});

describe('failures', () => {
  test('no key refuses before a job starts', async () => {
    mock.noKey = true;

    await expect(startOrganize()).rejects.toThrow(UserError);

    const { jobs } = await callTool('status', {}, ctx);
    const organizeJobs = jobs.filter((job) => job.kind === 'organize');
    const running = expect.objectContaining({ status: 'running' });
    expect(organizeJobs).toEqual(expect.not.arrayContaining([running]));
  });

  test('a rejected key stops the job, with no plan', async () => {
    await scanned({ 'a.txt': 'x' });
    mock.doDecide = () => Promise.reject(apiError(401));

    const job = await organize();

    expect(job).toMatchObject({ status: 'failed' });
    expect(job.error).toContain('rejected the API key');
    expect(await callTool('list_plans', {}, ctx)).toEqual([]);
  });

  test('another provider error fails that file, and the job goes on', async () => {
    await scanned({ 'bad.txt': 'bad', 'good.txt': 'good' });
    const answerWell = answering();
    mock.doDecide = (options: Parameters<DoDecide>[0]) => {
      const isBadFile = JSON.stringify(options.state).includes('bad.txt');
      return isBadFile ? Promise.reject(apiError(500)) : answerWell(options);
    };

    const job = await organize();

    expect(job).toMatchObject({ status: 'done', failed: 1, done: 2 });
    expect(ctx.db.fileByPath(at('bad.txt'))).toMatchObject({ status: 'failed' });
    expect(ctx.db.fileByPath(at('good.txt'))).toMatchObject({ status: 'organized' });
    expect(await planOps(job)).toHaveLength(1);
  });

  test('a file that vanished, or is too large to read, is failed and costs no call', async () => {
    await scanned({ 'gone.txt': 'x', 'big.pdf': PDF_OVER_ONE_MB });
    await rm(at('gone.txt'));
    ctx.config.budget.max_parse_mb = 1;

    const job = await organize();

    expect(job).toMatchObject({ status: 'done', failed: 2, total: 2 });
    expect(mock.doDecide).not.toHaveBeenCalled();
  });
});
