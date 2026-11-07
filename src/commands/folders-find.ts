/** Finds the virtual folder a `<folder>` argument names: by id, by path of names, or by name. */
import { t } from './i18n/index.ts';
import { UserError } from '../core/config.ts';
import type { Context } from '../core/tools.ts';
import type { VirtualFolderNode } from '../types.ts';
import { callTool } from './shared.ts';

interface NamedFolder {
  node: VirtualFolderNode;
  /** Names from the top down, such as `Taxes/2024`. */
  namePath: string;
}

/** Every saved folder, depth first, with the path of names that leads to it. */
function flattenTree(nodes: VirtualFolderNode[], parentNames: string[] = []): NamedFolder[] {
  return nodes.flatMap((node) => {
    const names = [...parentNames, node.name];
    return [{ node, namePath: names.join('/') }, ...flattenTree(node.children, names)];
  });
}

/** The folders whose path of names is `name`, else those whose own name is. */
function foldersNamed(allFolders: NamedFolder[], name: string): NamedFolder[] {
  const byPath = allFolders.filter(({ namePath }) => namePath === name);
  if (byPath.length > 0) return byPath;
  return allFolders.filter(({ node }) => node.name === name);
}

/** A `<folder>` argument: an id, else a path of names such as `Taxes/2024`, else a bare name. */
async function findFolder(folderArg: string, ctx: Context): Promise<VirtualFolderNode | undefined> {
  const allFolders = flattenTree((await callTool('list_vfolders', {}, ctx)).saved);
  const isId = /^\d+$/.test(folderArg);
  const byId = isId ? allFolders.find(({ node }) => node.key === folderArg) : undefined;
  if (byId) return byId.node;
  const matches = foldersNamed(allFolders, folderArg);
  if (matches.length > 1) {
    throw new UserError(
      t('{count} folders are named {name}. Use its id', { count: matches.length, name: folderArg }),
    );
  }
  return matches[0]?.node;
}

const noSuchFolder = (name: string) =>
  new UserError(t('There is no folder {name}. Run: jevonganize folders', { name }));

/** The saved folder `folderArg` names. A name that matches none is a `UserError`. */
export async function requireFolder(folderArg: string, ctx: Context): Promise<VirtualFolderNode> {
  const folder = await findFolder(folderArg, ctx);
  if (!folder) throw noSuchFolder(folderArg);
  return folder;
}

/** The id of the saved folder `folderArg` names. */
export const folderId = async (folderArg: string, ctx: Context) =>
  Number((await requireFolder(folderArg, ctx)).key);

/** A saved folder by id, or a generated one such as `topic:finance`, which has a colon. */
export async function folderRef(folderArg: string, ctx: Context) {
  const folder = await findFolder(folderArg, ctx);
  if (folder) return { id: Number(folder.key) };
  if (!folderArg.includes(':')) throw noSuchFolder(folderArg);
  return { generated: folderArg };
}
