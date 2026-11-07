/** Shared setup of the virtual folder tests: a tagged library and short calls to the folder tools. */
import { writeFile } from 'node:fs/promises';
import { readTags, writeTags } from '../src/core/tags.ts';
import { callTool, waitForJob } from '../src/core/tools.ts';
import type { VirtualFolderNode } from '../src/types.ts';
import { at, ctx, idOf, scanAll } from './tools-helpers.ts';

/** Five files and the tags each holds on disk: two tax years, a budget, a photo and a draft. */
export const LIBRARY = {
  'tax-2024.pdf': ['topic:finance/tax', 'doc-date:2024'],
  'tax-2025.pdf': ['topic:finance/tax', 'doc-date:2025-03'],
  'budget.xlsx': ['topic:finance', 'doc-date:2025'],
  'photo.jpg': ['doc-type:photo'],
  'draft.txt': ['to-read'],
};

/** Writes files with tags on disk, then scans them in. */
export async function tagged(files: Record<string, string[]>) {
  for (const [name, tags] of Object.entries(files)) {
    await writeFile(at(name), `text of ${name}`);
    await writeTags(at(name), tags);
  }
  await scanAll();
}

/** Input of `save_vfolder`. */
type SaveInput = Parameters<typeof callTool<'save_vfolder'>>[1];

/** Saves a virtual folder as the person at the CLI. */
export const save = (input: SaveInput) => callTool('save_vfolder', input, ctx);

/** The saved folders, as the tree `list_vfolders` returns. */
export const savedFolders = async () => (await callTool('list_vfolders', {}, ctx)).saved;

/** The sorted names of the files in a saved folder. */
export async function names(id: number): Promise<string[]> {
  const { files } = await callTool('vfolder_files', { id }, ctx);
  return files.map((file) => file.name).toSorted();
}

/** The sorted names of the files in a generated folder. */
export async function generatedNames(key: string): Promise<string[]> {
  const { files } = await callTool('vfolder_files', { generated: key }, ctx);
  return files.map((file) => file.name).toSorted();
}

/** The node with this key, anywhere in a tree of folders. */
export function findNode(nodes: VirtualFolderNode[], key: string): VirtualFolderNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node;
    const below = findNode(node.children, key);
    if (below) return below;
  }
  return undefined;
}

/** Saves Taxes (`topic:finance/tax`) and, below it, 2025 (`doc-date:2025`). */
export async function saveTaxYears() {
  const taxes = await save({ name: 'Taxes', rule: { tags: ['topic:finance/tax'] } });
  const year = await save({ name: '2025', parent: taxes.id, rule: { tags: ['doc-date:2025'] } });
  return { taxes, year };
}

/** Applies a plan as the person and waits for the job. */
export const applyPlan = async (id: string) =>
  waitForJob((await callTool('apply_plan', { id }, ctx)).id);

/** Undoes an applied plan and waits for the job. */
export const undoPlan = async (id: string) =>
  waitForJob((await callTool('undo_plan', { id }, ctx)).id);

/** The tags on disk of a file in the library. */
export const tagsOf = (name: string) => readTags(at(name));

/** The ids of library files, by name. */
export const fileIds = (...fileNames: string[]) => fileNames.map(idOf);
