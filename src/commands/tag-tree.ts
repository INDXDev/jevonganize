/** `tags tree` and `tags move`: the tag tree by facet and `/`, and moving a tag with its children. */
import { t } from './i18n/index.ts';
import { indexedPath, UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { TagNode } from '../types.ts';
import { finishPlan } from './plans.ts';
import { callTool, count, type JsonFlag, out, outJson, withContext } from './shared.ts';
import type { TagFlags } from './tags.ts';

/** The column the counts start at, so names of every depth line up. */
const COUNT_COLUMN = 32;

/** A node's files, with those on the tag itself when they differ from the total. */
function nodeCounts({ direct, total }: TagNode): string {
  const files = count(total);
  const showsDirect = direct > 0 && direct !== total;
  if (!showsDirect) return files;
  return t('{files}  ({direct} on the tag itself)', { files, direct: count(direct) });
}

/** Prints a tree level: the path at the top, then each label indented under its parent. */
function printTree(nodes: TagNode[], indent = ''): void {
  for (const node of nodes) {
    const name = sanitizeLine(indent === '' ? node.path : node.label);
    out(`${(indent + name).padEnd(COUNT_COLUMN)}${nodeCounts(node)}`);
    printTree(node.children, `${indent}  `);
  }
}

/** `tags tree`. */
export async function runTagsTree(
  flags: JsonFlag & { folder?: string; facet?: string },
): Promise<void> {
  await withContext(flags, async (ctx) => {
    const folder = flags.folder === undefined ? undefined : indexedPath(flags.folder);
    const tree = await callTool('list_tag_tree', { folder, facet: flags.facet }, ctx);
    if (flags.json) return outJson(tree);
    printTree(tree);
    return undefined;
  });
}

/** `tags move <tag> --under <parent>` or `--top`. Exactly one of them names the target. */
export async function runTagMove(
  from: string,
  flags: TagFlags & { under?: string; top?: boolean },
): Promise<void> {
  await withContext(flags, async (ctx) => {
    const hasOneTarget = (flags.under === undefined) === (flags.top === true);
    if (!hasOneTarget) throw new UserError(t('Give either --under <parent> or --top'));
    const parent = flags.top ? null : flags.under!;
    const plan = await callTool('move_tag', { from, parent }, ctx);
    await finishPlan(plan, flags, ctx);
  });
}
