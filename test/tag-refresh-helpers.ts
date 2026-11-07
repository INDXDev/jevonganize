/** Shared setup of the tag refresh tests: a library where each signal finds, or misses, one file. */
// First, so its mocks are in place before anything loads core/tools.ts.
import { at, ctx, fileId, organize, scan } from './organize-helpers.ts';
import { writeFile } from 'node:fs/promises';
import { writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import type { RefreshCandidates } from '../src/types.ts';

/** The tag the tests refresh. */
export const TAG = 'receipts';

/**
 * The text of each file. s1 and s2 hold the tag. c-text shares their words, c-tags their other tag,
 * and old-receipts only the tag in its name. n-none matches nothing, and r-rejected had the tag
 * removed by a person.
 */
const TEXTS: Record<string, string> = {
  's1.txt': 'invoice total amount due from acme corporation',
  's2.txt': 'invoice total amount due on payment',
  'c-text.txt': 'invoice total amount due for march',
  'c-tags.txt': 'holiday photos from the beach',
  'old-receipts.txt': 'random words here',
  'n-none.txt': 'a short poem about the quiet sea',
  'r-rejected.txt': 'invoice total amount due again',
};

/** The files a refresh of the tag should find, sorted. */
export const CANDIDATES = ['c-tags.txt', 'c-text.txt', 'old-receipts.txt'];

/** Writes and organizes the library of `TEXTS`, then rejects the tag on r-rejected.txt. */
export async function library() {
  for (const [name, text] of Object.entries(TEXTS)) await writeFile(at(name), text);
  await writeTags(at('s1.txt'), [TAG, 'party:acme']);
  await writeTags(at('s2.txt'), [TAG, 'party:acme']);
  await writeTags(at('c-tags.txt'), ['party:acme']);
  await scan();
  await organize(); // stores the searchable text, and each file's state
  ctx.db.rejectTag(fileId('r-rejected.txt'), TAG, 'a person removed it');
  ctx.db.refreshIdf();
}

/** The names of the candidates, in rank order. */
export const names = (found: RefreshCandidates) => found.candidates.map((c) => c.name);

/** Looks for candidates of the tag as the person. */
export const candidatesFor = (input: { tag: string; limit?: number } = { tag: TAG }) =>
  callTool('refresh_candidates', input, ctx);

/** Runs a refresh of the tag as the person and waits for the job. */
export const refresh = async (fileIds?: number[]) =>
  waitForJob((await callTool('refresh_tag', { tag: TAG, file_ids: fileIds }, ctx)).id);
