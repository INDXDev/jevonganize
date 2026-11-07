/** `jevonganize folders`: virtual folders, saved rules over tags. Thin: tools do the work. */
import { t } from './i18n/index.ts';
import type { Command } from 'commander';
import { indexedPath, UserError } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { Context } from '../core/tools.ts';
import type { Plan, VirtualFolderNode } from '../types.ts';
import {
  callTool,
  command,
  count,
  fileArg,
  type JsonFlag,
  out,
  outJson,
  printPlan,
  repeat,
  shown,
  someTags,
  withContext,
} from './shared.ts';

const DEFAULT_ROWS = 50;

/** Every saved folder, depth first, with the path of names that leads to it. */
function flatten(nodes: VirtualFolderNode[], above: string[] = []) {
  return nodes.flatMap((node): { node: VirtualFolderNode; path: string }[] => {
    const path = [...above, node.name];
    return [{ node, path: path.join('/') }, ...flatten(node.children, path)];
  });
}

/** A `<folder>` argument: an id, else a name or a path of names such as `Taxes/2024`. */
async function folderArg(arg: string, ctx: Context): Promise<VirtualFolderNode | undefined> {
  const all = flatten((await callTool('list_vfolders', {}, ctx)).saved);
  const byId = /^\d+$/.test(arg) && all.find(({ node }) => node.key === arg);
  if (byId) return byId.node;
  const byPath = all.filter(({ path }) => path === arg);
  const found = byPath.length ? byPath : all.filter(({ node }) => node.name === arg);
  if (found.length > 1) {
    throw new UserError(
      t('{count} folders are named {name}. Use its id', { count: found.length, name: arg }),
    );
  }
  return found[0]?.node;
}

async function requireFolder(arg: string, ctx: Context): Promise<VirtualFolderNode> {
  const found = await folderArg(arg, ctx);
  if (!found)
    throw new UserError(t('There is no folder {name}. Run: jevonganize folders', { name: arg }));
  return found;
}

/** What a folder collects, in one line. */
function ruleLine(node: VirtualFolderNode): string {
  const rule = node.folder?.rule;
  if (!rule) return node.key;
  const tags = rule.tags.join(rule.tag_match === 'any' ? ' | ' : ' & ');
  const parts = [tags, ...rule.exclude_tags.map((tag) => `-${tag}`)];
  if (rule.folder) parts.push(shown(rule.folder));
  return parts.filter(Boolean).join('  ') || t('every file');
}

function printTree(nodes: VirtualFolderNode[], depth = 0): void {
  for (const node of nodes) {
    const id = node.folder ? `  #${node.key}` : '';
    const home = node.folder?.tag ? `  → ${node.folder.tag}` : '';
    out(
      `${'  '.repeat(depth)}${sanitizeLine(node.name)}  ${count(node.count)}  ${sanitizeLine(ruleLine(node))}${sanitizeLine(home)}${id}`,
    );
    printTree(node.children, depth + 1);
  }
}

async function runList(flags: JsonFlag & { auto?: boolean }) {
  await withContext(flags, async (ctx) => {
    const tree = await callTool('list_vfolders', { generated: flags.auto }, ctx);
    if (flags.json) return outJson(tree);
    if (!tree.saved.length)
      out(t('No folders yet. Add one: jevonganize folders add <name> --tag <tag>'));
    printTree(tree.saved);
    if (flags.auto) {
      out(t('Auto:'));
      printTree(tree.generated, 1);
    }
    return undefined;
  });
}

interface AddFlags extends JsonFlag {
  tag?: string[];
  notTag?: string[];
  all?: boolean;
  parent?: string;
  home?: string;
  folder?: string;
}

async function runAdd(name: string, flags: AddFlags) {
  await withContext(flags, async (ctx) => {
    const parent =
      flags.parent === undefined ? null : Number((await requireFolder(flags.parent, ctx)).key);
    const rule = {
      tags: flags.tag ?? [],
      tag_match: flags.all ? ('all' as const) : ('any' as const),
      exclude_tags: flags.notTag ?? [],
      ...(flags.folder !== undefined && { folder: indexedPath(flags.folder) }),
    };
    const input = { name, parent, rule, ...(flags.home !== undefined && { tag: flags.home }) };
    const saved = await callTool('save_vfolder', input, ctx);
    if (flags.json) return outJson(saved);
    out(t('Saved folder {name} (id {id}).', { name: sanitizeLine(saved.name), id: saved.id }));
    return out(
      saved.tag
        ? t('Files put in it get {tag}.', { tag: sanitizeLine(saved.tag) })
        : t('It has no home tag, so files cannot be put in it. Add one with --home.'),
    );
  });
}

interface ShowFlags extends JsonFlag {
  limit?: number;
  offset?: number;
}

async function runShow(arg: string, flags: ShowFlags) {
  await withContext(flags, async (ctx) => {
    const found = await folderArg(arg, ctx);
    if (!found && !arg.includes(':')) {
      throw new UserError(t('There is no folder {name}. Run: jevonganize folders', { name: arg }));
    }
    const ref = found ? { id: Number(found.key) } : { generated: arg };
    const page = {
      limit: flags.limit ?? DEFAULT_ROWS,
      ...(flags.offset !== undefined && { offset: flags.offset }),
    };
    const result = await callTool('vfolder_files', { ...ref, ...page }, ctx);
    if (flags.json) return outJson(result);
    for (const file of result.files) out(`${shown(file.path)}  ${someTags(file.tags)}`);
    return out(
      t('{shown} of {total} files', {
        shown: count(result.files.length),
        total: count(result.total),
      }),
    );
  });
}

async function runRemove(arg: string, flags: JsonFlag) {
  await withContext(flags, async (ctx) => {
    const found = await requireFolder(arg, ctx);
    await callTool('delete_vfolder', { id: Number(found.key) }, ctx);
    if (flags.json) return outJson({ deleted: Number(found.key) });
    return out(
      t('Deleted folder {name}. No file or tag changed.', { name: sanitizeLine(found.name) }),
    );
  });
}

async function runMembership(arg: string, files: string[], flags: JsonFlag, adding: boolean) {
  await withContext(flags, async (ctx) => {
    const found = await requireFolder(arg, ctx);
    const fileIds: number[] = [];
    for (const file of files) fileIds.push((await fileArg(file, ctx)).id);
    const input = { id: Number(found.key), file_ids: fileIds };
    const plan: Plan = await callTool(
      adding ? 'add_to_vfolder' : 'remove_from_vfolder',
      input,
      ctx,
    );
    if (flags.json) return outJson(plan);
    printPlan(plan);
    return out(t('Nothing was written. Run: jevonganize apply {id}', { id: plan.id }));
  });
}

/** Adds `folders`. */
export function addFolderCommands(program: Command): void {
  const folders = program
    .command('folders')
    .description(t('Virtual folders: saved tag rules that collect files on their own'));
  folders
    .command('list', { isDefault: true })
    .description(t('Print the folder tree with counts'))
    .option('--json', t('Print JSON'))
    .option('--auto', t('Also print one folder per tag namespace and value'))
    .action(runList);
  command(folders, 'add <name>', t('Save a folder that collects files by their tags'))
    .option('--tag <tag>', t('Collect files with this tag. Repeatable'), repeat)
    .option('--all', t('Repeated --tag: a file needs all of them, not any'))
    .option('--not-tag <tag>', t('Leave out files with this tag. Repeatable'), repeat)
    .option('--parent <folder>', t('Put it inside this folder, which narrows it further'))
    .option('--home <tag>', t('The tag files put in it get'))
    .option('--folder <path>', t('Only this folder'))
    .action(runAdd);
  command(
    folders,
    'show <folder>',
    t('List the files in a folder, or in a tag such as topic:finance'),
  )
    .option('--limit <n>', t('At most this many'), Number)
    .option('--offset <n>', t('Skip this many'), Number)
    .action(runShow);
  command(
    folders,
    'rm <folder>',
    t('Delete a folder and the folders inside it. Files and tags stay'),
  ).action(runRemove);
  command(folders, 'put <folder> <files...>', t('Plan to give files the folder’s home tag')).action(
    (folder: string, files: string[], flags: JsonFlag) => runMembership(folder, files, flags, true),
  );
  command(
    folders,
    'take <folder> <files...>',
    t('Plan to remove the folder’s home tag from files'),
  ).action((folder: string, files: string[], flags: JsonFlag) =>
    runMembership(folder, files, flags, false),
  );
}
