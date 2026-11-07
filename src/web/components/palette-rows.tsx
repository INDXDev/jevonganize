/** The rows the command palette lists, from commands, favorites, tags, folders, files and actions, and how they are drawn. */
import { t } from '../i18n/index.ts';
import { Command as Cmdk } from 'cmdk';
import { CornerDownLeft, File, Folder, Hash, Star, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FileRow, Library, TagCount } from '../../types.ts';
import { act } from '../api.ts';
import { commands, type Command } from '../commands.ts';
import { keyLabel, shortPath } from '../lib.ts';
import { activeTab, setView, useTabs } from '../tabs.ts';
import { parseView, patchQuery } from '../view-query.ts';
import { setFavorite } from './favorite-star.tsx';
import { TagChip } from './tag-chip.tsx';

const ICON_CLASS = 'size-3.5 shrink-0 text-subtle';

/** One row of the palette, with what Enter and Mod+Enter run. */
export type PaletteRow = {
  id: string;
  /** What the search matches. */
  text: string;
  label: ReactNode;
  icon: ReactNode;
  keys?: string;
  group: Command['group'] | 'Commands' | 'Tags' | 'Folders' | 'Files' | 'Actions' | 'Recent';
  run: () => void;
  /** Mod+Enter, and the second row of the Tab submenu. */
  alt?: {
    title: 'Add to this filter' | 'Open in a new tab' | 'Reveal in the file manager';
    run: () => void;
  };
};

/** Every command that can run now, the palette's own aside. */
export const commandRows = (): PaletteRow[] =>
  commands
    .filter((command) => command.id !== 'palette' && (command.when?.() ?? true))
    .map((command) => ({
      id: command.id,
      text: `${command.title} ${command.id}`,
      label: command.title,
      icon: <Terminal className={ICON_CLASS} />,
      keys: command.keys,
      group: 'Commands',
      run: command.run,
    }));

/** "Add to favorites" for each tag of the tab's filter that is not starred yet. */
export const favoriteRows = (isFavorite: (tag: string) => boolean): PaletteRow[] =>
  parseView(activeTab().query)
    .tag.filter((tag) => !isFavorite(tag))
    .map((tag) => ({
      id: `favorite-${tag}`,
      text: t('Add to favorites: {tag}', { tag }),
      label: t('Add to favorites: {tag}', { tag }),
      icon: <Star className={ICON_CLASS} />,
      group: 'Commands',
      run: () => void setFavorite(tag, true),
    }));

/** A tag: Enter opens a new tab filtered by it, Mod+Enter adds it to this filter. */
export const tagRow = (entry: TagCount): PaletteRow => ({
  id: `tag-${entry.tag}`,
  text: entry.tag,
  label: <TagChip tag={entry.tag} count={entry.count} />,
  icon: <Hash className={ICON_CLASS} />,
  group: 'Tags',
  run: () => useTabs.getState().open(patchQuery('', { tag: [entry.tag] })),
  alt: {
    title: 'Add to this filter',
    run: () => setView({ tag: [...parseView(activeTab().query).tag, entry.tag] }),
  },
});

/** A library: Enter opens it here, Mod+Enter in a new tab. */
export const folderRow = (library: Library): PaletteRow => ({
  id: `folder-${library.path}`,
  text: library.path,
  label: <span className="font-mono text-xs">{shortPath(library.path)}</span>,
  icon: <Folder className={ICON_CLASS} />,
  group: 'Folders',
  run: () => setView({ screen: 'browse', folder: library.path, file: null }),
  alt: {
    title: 'Open in a new tab',
    run: () => useTabs.getState().open(patchQuery('', { folder: library.path })),
  },
});

/** A file found by the search: Enter opens it, Mod+Enter reveals it. */
export const fileRow = (file: FileRow, searchText: string): PaletteRow => ({
  id: `file-${file.id}`,
  // The search text is part of it, so the filter keeps every match the server found.
  text: `${file.name} ${searchText}`,
  label: (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{file.name}</span>
      <span className="truncate font-mono text-xs text-subtle">{shortPath(file.path)}</span>
    </span>
  ),
  icon: <File className={ICON_CLASS} />,
  group: 'Files',
  run: () => setView({ screen: 'browse', file: file.id }),
  alt: {
    title: 'Reveal in the file manager',
    run: () => void act('reveal_file', { id: file.id }),
  },
});

/** The Tab submenu of a row: its own action, and its alternative if it has one. */
export function submenuRows(row: PaletteRow): PaletteRow[] {
  const primary = {
    ...row,
    id: 'primary',
    label: t('Open'),
    keys: 'enter',
    group: 'Actions' as const,
  };
  if (!row.alt) return [primary];
  const { title, run } = row.alt;
  return [primary, { ...primary, id: 'alt', label: t(title), keys: 'mod+enter', run }];
}

/** The commands used last, by their ids. */
export const recentRows = (recent: string[], rows: PaletteRow[]) =>
  recent.flatMap((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row ? [{ ...row, id: `recent-${id}`, group: 'Recent' as const }] : [];
  });

/** The rows under their group headings. */
export function RowList(props: { rows: PaletteRow[]; onRun: (row: PaletteRow) => void }) {
  const { rows, onRun } = props;
  const groups = Map.groupBy(rows, (row) => row.group);
  return (
    <Cmdk.List className="max-h-[22rem] overflow-y-auto p-1">
      <Cmdk.Empty className="p-4 text-center text-sm text-subtle">{t('Nothing found.')}</Cmdk.Empty>
      {[...groups].map(([group, groupRows]) => (
        <Cmdk.Group key={group} heading={t(group)}>
          {groupRows.map((row) => (
            <Cmdk.Item
              key={row.id}
              value={row.id}
              onSelect={() => onRun(row)}
              className="flex h-row items-center gap-2 rounded-sm px-2 text-md data-[selected=true]:bg-soft"
            >
              {row.icon}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {row.keys && <span className="kbd">{keyLabel(row.keys)}</span>}
            </Cmdk.Item>
          ))}
        </Cmdk.Group>
      ))}
    </Cmdk.List>
  );
}

/** The footer that names the palette's keys. */
export function Hints() {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-xs text-subtle">
      <span className="flex items-center gap-1">
        <CornerDownLeft className="size-3" />
        {t('Run')}
      </span>
      <span>
        {keyLabel('mod+enter')} {t('Secondary')}
      </span>
      <span>{t('Tab Actions')}</span>
    </footer>
  );
}
