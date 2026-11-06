/** Shared setup of the extraction tests: fixtures, budgets, and one temp folder per test file. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, vi } from 'vitest';
import type { Config } from '../src/core/config.ts';
import { configSchema } from '../src/core/config.ts';
import { extractFile, optionalTools } from '../src/extract/index.ts';

const defaults = configSchema.parse({});

/** The path of a file in `test/fixtures/files`. */
export const fixture = (name: string) => join(import.meta.dirname, 'fixtures/files', name);

/** The default config, with some budget values and top-level settings replaced. */
export const config = (
  budget: Partial<Config['budget']> = {},
  rest: Partial<Config> = {},
): Config => ({
  ...defaults,
  ...rest,
  budget: { ...defaults.budget, ...budget },
});

/** Runs the pipeline on a fixture. */
export const extract = (name: string, budget?: Partial<Config['budget']>, rest?: Partial<Config>) =>
  extractFile(fixture(name), config(budget, rest));

/** Which optional programs this machine has, for tests that need one. */
export const tools = optionalTools();

/** The temp folder of the running test file. */
export let temp: string;

/** Gives the test file a temp folder, and time for workers that start cold. */
export function setupExtract(): void {
  vi.setConfig({ testTimeout: 20_000 });
  beforeAll(async () => {
    temp = await mkdtemp(join(tmpdir(), 'jev-extract-'));
  });
  afterAll(() => rm(temp, { recursive: true, force: true }));
}
