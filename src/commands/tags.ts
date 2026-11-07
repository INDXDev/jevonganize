/** `tags` and `cleanup`: list tags, plan changes to them, and report the untidy ones. */
import { t } from './i18n/index.ts';
import { stat } from 'node:fs/promises';
import { ifExists, indexedPath } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import { finishPlan } from './plans.ts';
import {
  callTool,
  count,
  fileArg,
  type JsonFlag,
  out,
  outJson,
  type QueryFlags,
  toQuery,
  withContext,
} from './shared.ts';

/** The flags of `tags add`, `tags remove` and `tags rename`. */
export interface TagFlags extends JsonFlag, QueryFlags {
  apply?: boolean;
}

/** `tags list`. */
export async function runTagsList(
  flags: JsonFlag & { folder?: string; facet?: string },
): Promise<void> {
  await withContext(flags, async (ctx) => {
    const folder = flags.folder === undefined ? undefined : indexedPath(flags.folder);
    const tags = await callTool('list_tags', { folder, facet: flags.facet }, ctx);
    if (flags.json) return outJson(tags);
    for (const { tag, count: files } of tags) out(`${sanitizeLine(tag).padEnd(24)}${count(files)}`);
    return undefined;
  });
}

/** The files a tag change touches: one file, or a folder narrowed by the query flags. */
async function changeScope(path: string, flags: QueryFlags, ctx: Context) {
  const target = indexedPath(path);
  const isFile = (await ifExists(stat(target)))?.isFile();
  if (isFile) return { file_ids: [(await fileArg(target, ctx)).id] };
  return { query: { ...toQuery(flags), folder: target } };
}

/** The action of `tags add` or `tags remove`: proposes the change as a plan. */
export const runTagChange =
  (change: 'add' | 'remove') =>
  async (path: string, tags: string[], flags: TagFlags): Promise<void> => {
    await withContext(flags, async (ctx) => {
      const scope = await changeScope(path, flags, ctx);
      const title = `${change} ${tags.join(', ')}`;
      const plan = await callTool('propose_changes', { ...scope, [change]: tags, title }, ctx);
      await finishPlan(plan, flags, ctx);
    });
  };

/** `tags rename <from> <to>`, with `--children` for every tag under it too. */
export async function runTagRename(
  from: string,
  to: string,
  flags: TagFlags & { children?: boolean },
): Promise<void> {
  await withContext(flags, async (ctx) => {
    const children = flags.children === true ? { children: true } : {};
    const plan = await callTool('rename_tag', { from, to, ...children }, ctx);
    await finishPlan(plan, flags, ctx);
  });
}

/** `cleanup`: near-duplicate, one-file and over-broad tags, and redundant parents. */
export async function runCleanup(flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const report = await callTool('cleanup_report', {}, ctx);
    if (flags.json) return outJson(report);
    const { files: indexedFiles } = await callTool('status', {}, ctx);
    out(t('Near-duplicates'));
    for (const { tags, files } of report.near_duplicates) {
      out(`  ${tags.map(sanitizeLine).join(' / ')}   ${count(files)}`);
    }
    out(t('One file'));
    for (const { tag } of report.single_use) out(`  ${sanitizeLine(tag)}`);
    out(t('Over-broad'));
    for (const row of report.over_broad) {
      const percent = Math.round((row.count / indexedFiles) * 100);
      out(t('  {tag}   on {percent}% of files', { tag: sanitizeLine(row.tag), percent }));
    }
    out(t('Redundant parents'));
    for (const { tag, parent, files } of report.redundant_parents) {
      const names = { tag: sanitizeLine(tag), parent: sanitizeLine(parent) };
      out(t('  {tag} with {parent}   {files} files', { ...names, files: count(files) }));
    }
    return undefined;
  });
}
