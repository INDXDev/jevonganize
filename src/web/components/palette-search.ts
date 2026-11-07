/** What the palette searches: the scope typed first, the rows that scope fetches, and the filter. */
import { useTool } from '../api.ts';
import { fileRow, folderRow, recentRows, tagRow, type PaletteRow } from './palette-rows.tsx';

/** Files are searched from this many characters on: one matches nearly everything. */
const MIN_FILE_SEARCH = 2;
/** How many files a search lists, under the commands. */
const FILE_RESULTS = 8;

/** The character that limits a search to commands, tags or folders. */
type Scope = '>' | '#' | '@' | '';

/** The scope a typed string asks for: its first character when that is `>`, `#` or `@`. */
const scopeOf = (typed: string): Scope => (/^[>#@]/.test(typed) ? (typed[0] as Scope) : '');

/** Parses what was typed, and fetches the rows its scope asks for. */
export function usePaletteSearch(isOpen: boolean, typed: string) {
  const scope = scopeOf(typed);
  const searchText = (scope ? typed.slice(1) : typed).trim();
  const wantsFiles = isOpen && !scope && searchText.length >= MIN_FILE_SEARCH;
  const { data: tags } = useTool('list_tags', {}, { enabled: isOpen && scope === '#' });
  const { data: libraries } = useTool('list_libraries', {}, { enabled: isOpen && scope === '@' });
  const { data: found } = useTool(
    'search_files',
    { text: searchText, limit: FILE_RESULTS },
    { enabled: wantsFiles },
  );
  const results = { tags: tags ?? [], libraries: libraries ?? [], files: found?.files ?? [] };
  return { scope, searchText, ...results };
}

type PaletteSearch = ReturnType<typeof usePaletteSearch>;

/** The rows a search shows, before the filter. With no scope: recents, commands, then files. */
export function searchRows(search: PaletteSearch, commandList: PaletteRow[], recentIds: string[]) {
  const { scope, searchText } = search;
  if (scope === '>') return commandList;
  if (scope === '#') return search.tags.map(tagRow);
  if (scope === '@') return search.libraries.map(folderRow);
  const recents = searchText ? [] : recentRows(recentIds, commandList);
  const files = search.files.map((file) => fileRow(file, searchText));
  return [...recents, ...commandList, ...files];
}

/** Cmdk's filter: 1 keeps a row, 0 hides it. A submenu shows whole. */
export function rowFilter(rows: PaletteRow[], scope: Scope, inSubmenu: boolean) {
  return (id: string, typed: string) => {
    const needle = (scope ? typed.slice(1) : typed).trim().toLowerCase();
    if (!needle || inSubmenu) return 1;
    const row = rows.find((candidate) => candidate.id === id);
    return row?.text.toLowerCase().includes(needle) ? 1 : 0;
  };
}
