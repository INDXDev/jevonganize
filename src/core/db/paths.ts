/** Path arithmetic the queries share, in SQL and in code. */
import { sep } from 'node:path';

/** The SQL for a path's last segment. rtrim strips the trailing run of non-separators. */
export const fileName = (path: string) =>
  `substr(${path}, length(rtrim(${path}, replace(${path}, '${sep}', ''))) + 1)`;

/** The bounds of everything under a folder: `sep` and the character right after it. */
export function folderRange(folder: string): [string, string] {
  const base = folder.endsWith(sep) ? folder.slice(0, -1) : folder;
  return [base + sep, base + String.fromCodePoint(sep.codePointAt(0)! + 1)];
}
