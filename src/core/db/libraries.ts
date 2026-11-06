/** The folders in the index. */
import type { Library } from '../../types.ts';
import type { Sql } from './connection.ts';
import { deleteFile, filesUnder } from './files.ts';
import { folderRange } from './paths.ts';

/** Adds a folder. Adding it twice changes nothing. */
export function addLibrary(sql: Sql, path: string): void {
  sql.run('INSERT OR IGNORE INTO library (path) VALUES (?)', path);
}

/** Forgets a folder and its index rows, except files inside another library. Tags stay. */
export function removeLibrary(sql: Sql, path: string): void {
  sql.transaction(() => {
    sql.run('DELETE FROM library WHERE path = ?', path);
    const others = sql.all<{ path: string }>('SELECT path FROM library').map((row) => row.path);
    for (const file of filesUnder(sql, path)) {
      if (!others.some((other) => file.path.startsWith(folderRange(other)[0]))) {
        deleteFile(sql, file.id);
      }
    }
  });
}

/** All libraries with their file counts. `taggable` needs the disk, so tools add it. */
export function listLibraries(sql: Sql): Omit<Library, 'taggable'>[] {
  return sql
    .all<{ path: string; scanned_at: number | null }>(
      'SELECT path, scanned_at FROM library ORDER BY path',
    )
    .map((library) => ({
      ...library,
      files: sql.get<{ n: number }>(
        'SELECT count(*) AS n FROM file WHERE path >= ? AND path < ?',
        ...folderRange(library.path),
      )!.n,
    }));
}

/** Every library's path, without the count of its files that `listLibraries` pays for. */
export const libraryPaths = (sql: Sql) =>
  sql.all<{ path: string }>('SELECT path FROM library ORDER BY path').map(({ path }) => path);

/** Stamps a library as scanned now. Does nothing for a folder that is not a library. */
export function markScanned(sql: Sql, path: string): void {
  sql.run('UPDATE library SET scanned_at = ? WHERE path = ?', Date.now(), path);
}
