import { t, useLanguage } from '../i18n/index.ts';
import { Command as Cmdk } from 'cmdk';
import { CornerDownLeft, File, Folder, Hash, Terminal } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FileRow, Library, TagCount } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { commands, type Command } from '../commands.ts';
import { keyLabel, shortPath, useReset } from '../lib.ts';
import { activeTab, setView, useTabs, useWindow } from '../tabs.ts';
import { parseView, patchQuery } from '../view-query.ts';
import { TagChip } from './tag-chip.tsx';
import { Dialog } from './ui/dialog.tsx';

type Row = {
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

const close = () => useWindow.setState({ overlay: null });
const icon = 'size-3.5 shrink-0 text-subtle';

const remember = (id: string) =>
  useWindow.setState((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, 5) }));

const commandRows = (): Row[] =>
  commands
    .filter((c) => c.id !== 'palette' && (c.when?.() ?? true))
    .map((c) => ({
      id: c.id,
      text: `${c.title} ${c.id}`,
      label: c.title,
      icon: <Terminal className={icon} />,
      keys: c.keys,
      group: 'Commands',
      run: c.run,
    }));

const tagRow = (entry: TagCount): Row => ({
  id: `tag-${entry.tag}`,
  text: entry.tag,
  label: <TagChip tag={entry.tag} count={entry.count} />,
  icon: <Hash className={icon} />,
  group: 'Tags',
  run: () => useTabs.getState().open(patchQuery('', { tag: [entry.tag] })),
  alt: {
    title: 'Add to this filter',
    run: () => setView({ tag: [...parseView(activeTab().query).tag, entry.tag] }),
  },
});

const folderRow = (l: Library): Row => ({
  id: `folder-${l.path}`,
  text: l.path,
  label: <span className="font-mono text-xs">{shortPath(l.path)}</span>,
  icon: <Folder className={icon} />,
  group: 'Folders',
  run: () => setView({ screen: 'browse', folder: l.path, file: null }),
  alt: {
    title: 'Open in a new tab',
    run: () => useTabs.getState().open(patchQuery('', { folder: l.path })),
  },
});

const fileRow = (f: FileRow, search: string): Row => ({
  id: `file-${f.id}`,
  text: `${f.name} ${search}`,
  label: (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{f.name}</span>
      <span className="truncate font-mono text-xs text-subtle">{shortPath(f.path)}</span>
    </span>
  ),
  icon: <File className={icon} />,
  group: 'Files',
  run: () => setView({ screen: 'browse', file: f.id }),
  alt: { title: 'Reveal in the file manager', run: () => void act('reveal_file', { id: f.id }) },
});

/** The Tab submenu of a row. */
function actionRows(menu: Row): Row[] {
  const primary = {
    ...menu,
    id: 'primary',
    label: t('Open'),
    keys: 'enter',
    group: 'Actions' as const,
  };
  if (!menu.alt) return [primary];
  const { title, run } = menu.alt;
  return [primary, { ...primary, id: 'alt', label: t(title), keys: 'mod+enter', run }];
}

/** The commands used last, by their ids. */
const recentRows = (recent: string[], rows: Row[]) =>
  recent.flatMap((id) => {
    const row = rows.find((r) => r.id === id);
    return row ? [{ ...row, id: `recent-${id}`, group: 'Recent' as const }] : [];
  });

/** Parses what was typed, and fetches the rows it asks for. */
function usePaletteSearch(open: boolean, input: string) {
  const prefix = /^[>#@]/.test(input) ? input[0] : '';
  const text = (prefix ? input.slice(1) : input).trim();
  const { data: tags } = useTool('list_tags', {}, { enabled: open && prefix === '#' });
  const { data: libraries } = useTool('list_libraries', {}, { enabled: open && prefix === '@' });
  const { data: found } = useTool(
    'search_files',
    { text, limit: 8 },
    { enabled: open && !prefix && text.length > 1 },
  );
  return { prefix, text, tags: tags ?? [], libraries: libraries ?? [], files: found?.files ?? [] };
}

type Search = ReturnType<typeof usePaletteSearch>;

/** The rows a search shows, before the filter. */
function searchRows(search: Search, commandList: Row[], recent: string[]): Row[] {
  const { prefix, text } = search;
  if (prefix === '>') return commandList;
  if (prefix === '#') return search.tags.map(tagRow);
  if (prefix === '@') return search.libraries.map(folderRow);
  const recents = text ? [] : recentRows(recent, commandList);
  return [...recents, ...commandList, ...search.files.map((f) => fileRow(f, text))];
}

const runRow = (row: Row, how: () => void = row.run) => {
  close();
  if (!row.id.startsWith('tag-') && !row.id.startsWith('f'))
    remember(row.id.replace('recent-', ''));
  how();
};

function RowList({ rows }: { rows: Row[] }) {
  const groups = Map.groupBy(rows, (r) => r.group);
  return (
    <Cmdk.List className="max-h-[22rem] overflow-y-auto p-1">
      <Cmdk.Empty className="p-4 text-center text-sm text-subtle">{t('Nothing found.')}</Cmdk.Empty>
      {[...groups].map(([group, items]) => (
        <Cmdk.Group key={group} heading={t(group)}>
          {items.map((row) => (
            <Cmdk.Item
              key={row.id}
              value={row.id}
              onSelect={() => runRow(row)}
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

function Hints() {
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

/** Mod+K. `>` commands, `#` tags, `@` folders, nothing for recents, commands and files. */
export function Palette() {
  useLanguage();
  const open = useWindow((s) => s.overlay === 'palette');
  const recent = useWindow((s) => s.recent);
  const [input, setInput] = useState('');
  const [value, setValue] = useState('');
  const [menu, setMenu] = useState<Row | null>(null);

  useReset(open, () => {
    setInput('');
    setMenu(null);
  });

  const search = usePaletteSearch(open, input);
  const commandList = open ? commandRows() : [];
  const rows = menu ? actionRows(menu) : searchRows(search, commandList, recent);
  const current = rows.find((r) => r.id === value);

  const filter = (id: string, typed: string) => {
    const row = rows.find((r) => r.id === id);
    const needle = (search.prefix ? typed.slice(1) : typed).trim().toLowerCase();
    if (!needle || menu) return 1;
    return row?.text.toLowerCase().includes(needle) ? 1 : 0;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && current) {
      e.preventDefault();
      setMenu(menu ? null : current);
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && current?.alt) {
      e.preventDefault();
      runRow(current, current.alt.run);
    } else if (e.key === 'Escape' && menu) {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={t('Command palette')} bare>
      <Cmdk
        label={t('Command palette')}
        value={value}
        onValueChange={setValue}
        filter={filter}
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-col"
      >
        <Cmdk.Input
          value={input}
          onValueChange={setInput}
          placeholder={t('Search, or > commands, # tags, @ folders')}
          className="h-10 w-full shrink-0 border-b bg-transparent px-3 text-lg outline-none placeholder:text-subtle"
        />
        <RowList rows={rows} />
        <Hints />
      </Cmdk>
    </Dialog>
  );
}
