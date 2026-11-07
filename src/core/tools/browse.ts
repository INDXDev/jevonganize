/**
 * The folder picker's view of the disk, for `browse_dirs`. It lists and never enters a link, and it
 * reads no file: an entry is its name, kind, size and time.
 */
import type { Dirent } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DirListing } from '../../types.ts';
import { ifExists, UserError } from '../config.ts';

/** Why a folder cannot be listed, when that is the person's to fix: a file, or no permission. */
const UNREADABLE = new Set(['ENOTDIR', 'EACCES', 'EPERM']);

/** Folders in home that a file dialog usually shows at its side. */
const PLACES = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Videos', 'Music'];

/** The folders a file dialog lists at its side, where they exist. */
async function usualPlaces(): Promise<string[]> {
  const home = homedir();
  const paths = PLACES.map((name) => join(home, name));
  const found = await Promise.all(paths.map((path) => ifExists(stat(path))));
  return [home, ...paths.filter((_, index) => found[index]?.isDirectory())];
}

/** A folder's entries, or a `UserError` the person can act on. */
async function readFolder(dir: string): Promise<Dirent[]> {
  const entries = await ifExists(readdir(dir, { withFileTypes: true })).catch(
    (error: NodeJS.ErrnoException) => {
      if (UNREADABLE.has(error.code ?? '')) throw new UserError(`Cannot open ${dir}`);
      throw error;
    },
  );
  if (!entries) throw new UserError(`${dir} does not exist`);
  return entries;
}

/** One entry as the folder picker shows it. */
async function describeEntry(dir: string, entry: Dirent): Promise<DirListing['entries'][number]> {
  // lstat, so a link reports itself. It is listed but never entered.
  const info = await lstat(join(dir, entry.name)).catch(() => undefined);
  return {
    name: entry.name,
    dir: entry.isDirectory(),
    size: info?.size ?? null,
    modified: info?.mtimeMs ?? null,
  };
}

/** A folder for the folder picker, home by default, with the usual places beside it. */
export async function browseDirs(path: string | undefined): Promise<DirListing> {
  const dir = resolve(path ?? homedir());
  const entries = await readFolder(dir);
  const parent = dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? null : parent,
    places: await usualPlaces(),
    entries: await Promise.all(entries.map((entry) => describeEntry(dir, entry))),
  };
}
