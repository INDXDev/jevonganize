import { t, useLanguage } from '../i18n/index.ts';
import { Command as Cmdk } from 'cmdk';
import { useState, type KeyboardEvent } from 'react';
import { useReset } from '../lib.ts';
import { useWindow } from '../tabs.ts';
import { useFavorites } from './favorite-star.tsx';
import {
  commandRows,
  favoriteRows,
  Hints,
  RowList,
  submenuRows,
  type PaletteRow,
} from './palette-rows.tsx';
import { rowFilter, searchRows, usePaletteSearch } from './palette-search.ts';
import { Dialog } from './ui/dialog.tsx';

/** How many recent commands the palette keeps. */
const MAX_RECENT = 5;

const closePalette = () => useWindow.setState({ overlay: null });

/** Puts a command first in the recent list, keeping it short. */
const rememberCommand = (id: string) =>
  useWindow.setState((windowState) => {
    const others = windowState.recent.filter((known) => known !== id);
    return { recent: [id, ...others].slice(0, MAX_RECENT) };
  });

/** Row id prefixes of what is not a command. Those rows depend on the moment, so they are never recent. */
const NOT_COMMAND_PREFIXES = ['tag-', 'favorite-', 'folder-', 'file-'];

/** True for a command's row, recent or not. */
const isCommandRow = (id: string) => !NOT_COMMAND_PREFIXES.some((prefix) => id.startsWith(prefix));

/** Closes the palette, keeps a command among the recents, and runs `action`, one of the row's. */
function runFromPalette(row: PaletteRow, action: () => void) {
  closePalette();
  // A recent row's id is its command's id behind `recent-`.
  const commandId = row.id.replace(/^recent-/, '');
  if (isCommandRow(row.id)) rememberCommand(commandId);
  action();
}

/**
 * The palette's own keys: Tab opens or closes the submenu, Mod+Enter runs the alternative, and
 * Escape leaves the submenu first, so it closes the palette only from the top level.
 */
function keyHandler(
  highlighted: PaletteRow | undefined,
  submenuRow: PaletteRow | null,
  setSubmenuRow: (row: PaletteRow | null) => void,
) {
  return (e: KeyboardEvent) => {
    const isModEnter = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
    if (e.key === 'Tab' && highlighted) {
      e.preventDefault();
      setSubmenuRow(submenuRow ? null : highlighted);
      return;
    }
    if (isModEnter && highlighted?.alt) {
      e.preventDefault();
      runFromPalette(highlighted, highlighted.alt.run);
      return;
    }
    if (e.key === 'Escape' && submenuRow) {
      e.preventDefault();
      e.stopPropagation();
      setSubmenuRow(null);
    }
  };
}

/** What is typed, which row is highlighted, and the submenu it opened, if any. */
function usePaletteState(isOpen: boolean) {
  const recentIds = useWindow((s) => s.recent);
  const [input, setInput] = useState('');
  const [highlightedId, setHighlightedId] = useState('');
  const [submenuRow, setSubmenuRow] = useState<PaletteRow | null>(null);
  useReset(isOpen, () => {
    setInput('');
    setSubmenuRow(null);
  });

  const search = usePaletteSearch(isOpen, input);
  const { isFavorite } = useFavorites();
  const commandList = isOpen ? [...commandRows(), ...favoriteRows(isFavorite)] : [];
  const rows = submenuRow ? submenuRows(submenuRow) : searchRows(search, commandList, recentIds);
  const highlighted = rows.find((row) => row.id === highlightedId);

  const keepRow = rowFilter(rows, search.scope, !!submenuRow);
  const onKeyDown = keyHandler(highlighted, submenuRow, setSubmenuRow);
  return { input, setInput, highlightedId, setHighlightedId, rows, keepRow, onKeyDown };
}

/** Mod+K. `>` commands, `#` tags, `@` folders, nothing for recents, commands and files. */
export function Palette() {
  useLanguage();
  const isOpen = useWindow((s) => s.overlay === 'palette');
  const state = usePaletteState(isOpen);
  return (
    <Dialog open={isOpen} onClose={closePalette} title={t('Command palette')} bare>
      <Cmdk
        label={t('Command palette')}
        value={state.highlightedId}
        onValueChange={state.setHighlightedId}
        filter={state.keepRow}
        onKeyDown={state.onKeyDown}
        className="flex min-h-0 flex-col"
      >
        <Cmdk.Input
          value={state.input}
          onValueChange={state.setInput}
          placeholder={t('Search, or > commands, # tags, @ folders')}
          className="h-10 w-full shrink-0 border-b bg-transparent px-3 text-lg outline-none placeholder:text-subtle"
        />
        <RowList rows={state.rows} onRun={(row) => runFromPalette(row, row.run)} />
        <Hints />
      </Cmdk>
    </Dialog>
  );
}
