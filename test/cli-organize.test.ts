import { expect, test } from 'vitest';
import { readTags } from '../src/core/tags.ts';
import type { Estimate, Job, Plan } from '../src/types.ts';
import { cli, ndjson, printedPlanId, root, scanFiles, setupCliHome } from './cli-helpers.ts';
import { useStubProvider } from './cli-provider-helpers.ts';

setupCliHome();
const provider = useStubProvider();

/** Organizes the library on `doc-type` alone, with the extra flags. */
const organize = (...flags: string[]) => cli(['organize', root, '--facets', 'doc-type', ...flags]);

/** Scans one invoice into the library, and returns its path. */
const scanInvoice = async () => (await scanFiles({ 'invoice.txt': 'Invoice 44' }))['invoice.txt']!;

test('--no-apply prints the plan and writes nothing', async () => {
  const path = await scanInvoice();
  const organized = await organize('--no-apply');
  expect(organized.code).toBe(0);
  expect(organized.stderr).toContain('tokens');
  expect(organized.stdout).toContain('doc-type:invoice');
  expect(organized.stdout).toContain('Nothing was written.');
  expect(await readTags(path)).toEqual([]);
});

test('the request carries the file content and never the folder path', async () => {
  await scanInvoice();
  await organize('--no-apply');
  expect(provider.requests).toHaveLength(1);
  expect(provider.requests[0]).toContain('Invoice 44');
  expect(provider.requests[0]).not.toContain(root);
});

test('a proposed organize plan applies and undoes through the real binary', async () => {
  const path = await scanInvoice();
  const id = printedPlanId((await organize('--no-apply')).stdout);
  const plan = JSON.parse((await cli(['plans', id, '--json'])).stdout) as Plan;
  expect(plan).toMatchObject({ source: 'organize', status: 'proposed' });
  await cli(['apply', id]);
  expect(await readTags(path)).toEqual(['doc-type:invoice']);
  await cli(['undo', id]);
  expect(await readTags(path)).toEqual([]);
});

test('organize applies by default, and undo takes the tags back', async () => {
  const path = await scanInvoice();
  const { stdout } = await organize();
  expect(await readTags(path)).toEqual(['doc-type:invoice']);
  await cli(['undo', printedPlanId(stdout, 'undo')]);
  expect(await readTags(path)).toEqual([]);
});

test('--json is NDJSON with the plan id on the last job', async () => {
  await scanInvoice();
  const organizeJob = ndjson<Job>((await organize('--no-apply', '--json')).stdout).at(-1);
  expect(organizeJob).toMatchObject({ kind: 'organize', status: 'done' });
  expect(organizeJob?.plan_id).toBeTruthy();
});

test('answers are cached: a dry run counts them, and applying sends nothing again', async () => {
  const path = await scanInvoice();
  await organize('--no-apply', '--json');
  const dry = await organize('--dry-run', '--json');
  expect(JSON.parse(dry.stdout)).toMatchObject<Partial<Estimate>>({ cached: 1 });
  const applied = ndjson<Job>((await organize('--json')).stdout);
  expect(applied.at(-1)).toMatchObject({ kind: 'apply', status: 'done' });
  expect(provider.requests).toHaveLength(1);
  expect(await readTags(path)).toEqual(['doc-type:invoice']);
});
