/** `jevonganize folders`: virtual folders, saved rules over tags. Thin: tools do the work. */
import { t } from './i18n/index.ts';
import type { Command } from 'commander';
import { indexedPath } from '../core/config.ts';
import { sanitizeLine } from '../core/sanitize.ts';
import type { VirtualFolderNode } from '../types.ts';
import { folderId, folderRef, requireFolder } from './folders-find.ts';
import { addFolderSuggestCommand } from './folders-suggest.ts';
import { nothingWritten } from './plans.ts';
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

/** What a folder collects, in one line. */
function describeRule(node: VirtualFolderNode): string {
  const rule = node.folder?.rule;
  if (!rule) return node.key;
  const tags = rule.tags.join(rule.tag_match === 'any' ? ' | ' : ' & ');
  const parts = [tags, ...rule.exclude_tags.map((tag) => `-${tag}`)];
  if (rule.folder) parts.push(shown(rule.folder));
  return parts.filter(Boolean).join('  ') || t('every file');
}

function printTree(nodes: VirtualFolderNode[], depth = 0): void {
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const name = sanitizeLine(node.name);
    const rule = sanitizeLine(describeRule(node));
    const homeTag = sanitizeLine(node.folder?.tag ? `  → ${node.folder.tag}` : '');
    const id = node.folder ? `  #${node.key}` : '';
    out(`${indent}${name}  ${count(node.count)}  ${rule}${homeTag}${id}`);
    printTree(node.children, depth + 1);
  }
}

async function runFolderList(flags: JsonFlag & { auto?: boolean }): Promise<void> {
  await withContext(flags, async (ctx) => {
    const tree = await callTool('list_vfolders', { generated: flags.auto }, ctx);
    if (flags.json) return outJson(tree);
    if (tree.saved.length === 0)
      out(t('No folders yet. Add one: jevonganize folders add <name> --tag <tag>'));
    printTree(tree.saved);
    if (flags.auto) {
      out(t('Auto:'));
      printTree(tree.generated, 1);
    }
    return undefined;
  });
}

interface FolderAddFlags extends JsonFlag {
  tag?: string[];
  notTag?: string[];
  all?: boolean;
  parent?: string;
  home?: string;
  folder?: string;
}

function ruleFromFlags(flags: FolderAddFlags) {
  return {
    tags: flags.tag ?? [],
    tag_match: flags.all ? ('all' as const) : ('any' as const),
    exclude_tags: flags.notTag ?? [],
    ...(flags.folder !== undefined && { folder: indexedPath(flags.folder) }),
  };
}

async function runFolderAdd(name: string, flags: FolderAddFlags): Promise<void> {
  await withContext(flags, async (ctx) => {
    const parent = flags.parent === undefined ? null : await folderId(flags.parent, ctx);
    const rule = ruleFromFlags(flags);
    const input = { name, parent, rule, ...(flags.home !== undefined && { tag: flags.home }) };
    const saved = await callTool('save_vfolder', input, ctx);
    if (flags.json) return outJson(saved);
    out(t('Saved folder {name} (id {id}).', { name: sanitizeLine(saved.name), id: saved.id }));
    if (saved.tag) return out(t('Files put in it get {tag}.', { tag: sanitizeLine(saved.tag) }));
    return out(t('It has no home tag, so files cannot be put in it. Add one with --home.'));
  });
}

interface FolderShowFlags extends JsonFlag {
  limit?: number;
  offset?: number;
}

async function runFolderShow(folderArg: string, flags: FolderShowFlags): Promise<void> {
  await withContext(flags, async (ctx) => {
    const folder = await folderRef(folderArg, ctx);
    const page = {
      limit: flags.limit ?? DEFAULT_ROWS,
      ...(flags.offset !== undefined && { offset: flags.offset }),
    };
    const result = await callTool('vfolder_files', { ...folder, ...page }, ctx);
    if (flags.json) return outJson(result);
    for (const file of result.files) out(`${shown(file.path)}  ${someTags(file.tags)}`);
    const shownCount = count(result.files.length);
    return out(t('{shown} of {total} files', { shown: shownCount, total: count(result.total) }));
  });
}

async function runFolderRemove(folderArg: string, flags: JsonFlag): Promise<void> {
  await withContext(flags, async (ctx) => {
    const folder = await requireFolder(folderArg, ctx);
    const id = Number(folder.key);
    await callTool('delete_vfolder', { id }, ctx);
    if (flags.json) return outJson({ deleted: id });
    const name = sanitizeLine(folder.name);
    return out(t('Deleted folder {name}. No file or tag changed.', { name }));
  });
}

/** `put` and `take`: plans to give files a folder's home tag, or to take it away. */
const runMembership =
  (tool: 'add_to_vfolder' | 'remove_from_vfolder') =>
  async (folderArg: string, files: string[], flags: JsonFlag): Promise<void> => {
    await withContext(flags, async (ctx) => {
      const id = await folderId(folderArg, ctx);
      const fileIds: number[] = [];
      for (const file of files) fileIds.push((await fileArg(file, ctx)).id);
      const plan = await callTool(tool, { id, file_ids: fileIds }, ctx);
      if (flags.json) return outJson(plan);
      printPlan(plan);
      return nothingWritten(plan.id);
    });
  };

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
    .action(runFolderList);
  command(folders, 'add <name>', t('Save a folder that collects files by their tags'))
    .option('--tag <tag>', t('Collect files with this tag. Repeatable'), repeat)
    .option('--all', t('Repeated --tag: a file needs all of them, not any'))
    .option('--not-tag <tag>', t('Leave out files with this tag. Repeatable'), repeat)
    .option('--parent <folder>', t('Put it inside this folder, which narrows it further'))
    .option('--home <tag>', t('The tag files put in it get'))
    .option('--folder <path>', t('Only this folder'))
    .action(runFolderAdd);
  const showHelp = t('List the files in a folder, or in a tag such as topic:finance');
  command(folders, 'show <folder>', showHelp)
    .option('--limit <n>', t('At most this many'), Number)
    .option('--offset <n>', t('Skip this many'), Number)
    .action(runFolderShow);
  addFolderSuggestCommand(folders);
  const removeHelp = t('Delete a folder and the folders inside it. Files and tags stay');
  command(folders, 'rm <folder>', removeHelp).action(runFolderRemove);
  const putHelp = t('Plan to give files the folder’s home tag');
  command(folders, 'put <folder> <files...>', putHelp).action(runMembership('add_to_vfolder'));
  const takeHelp = t('Plan to remove the folder’s home tag from files');
  command(folders, 'take <folder> <files...>', takeHelp).action(
    runMembership('remove_from_vfolder'),
  );
}
