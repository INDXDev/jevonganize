/** Shared setup of the tool tests: a context on a temp home, holding one empty library. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { callTool, type Context, openContext, waitForJob } from '../src/core/tools.ts';
import type { ServerEvent } from '../src/types.ts';
import { useTempHome } from './helpers.ts';

/** The context of the running test. */
export let ctx: Context;
/** The library of the running test. */
export let root: string;
/** What the running test's context has emitted. */
export let events: ServerEvent[];
/** The temp home of the running test. */
export let home: () => string;

/** Gives each test in the file a temp home, a context and an empty library. */
export function setupToolContext(): void {
  vi.setConfig({ testTimeout: 30_000 }); // real workers, which a busy machine can hold up
  home = useTempHome();
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
}

/** A path inside the library. */
export const at = (name: string) => join(root, name);

/** The running context, as another caller. */
export const as = (caller: Context['caller'], approved?: boolean): Context => ({
  ...ctx,
  caller,
  approved,
});

/** Scans every library and waits for the job. */
export const scanAll = async () => waitForJob((await callTool('scan', {}, ctx)).id);

/** Writes files into the library and scans them. */
export async function scanned(...names: string[]) {
  for (const name of names) await writeFile(at(name), `text of ${name}`);
  await scanAll();
}

/** The index id of a file in the library. */
export const idOf = (name: string) => ctx.db.fileByPath(at(name))!.id;

/** Proposes adding the tag `x` to a.txt. */
export const proposeTag = () =>
  callTool('propose_changes', { file_ids: [idOf('a.txt')], add: ['x'], title: 't' }, ctx);

/** Queues a review item on a.txt. */
export const addReview = (tag: string, kind: 'suggest' | 'restore' = 'suggest') =>
  ctx.db.addReview({ file_id: idOf('a.txt'), kind, tag, confidence: 0.6, reason: 'r' });

/** The ids of the open review items. */
export const ids = () => ctx.db.listReviews().map((item) => item.id);
