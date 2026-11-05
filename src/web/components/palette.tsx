import { Command as Cmdk } from 'cmdk';
import { CornerDownLeft, File, Folder, Hash, Terminal } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { act, useTool } from '../api.ts';
import { commands } from '../commands.ts';
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
  group: string;
  run: () => void;
  /** Mod+Enter, and the second row of the Tab submenu. */
  alt?: { title: string; run: () => void };
};

const close = () => useWindow.setState({ overlay: null });
const icon = 'size-3.5 shrink-0 text-subtle';

const remember = (id: string) =>
  useWindow.setState((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, 5) }));

/** Mod+K. `>` commands, `#` tags, `@` folders, nothing for recents, commands and files. */
export function Palette() {
  const open = useWindow((s) => s.overlay === 'palette');
  const recent = useWindow((s) => s.recent);
  const [input, setInput] = useState('');
  const [value, setValue] = useState('');
  const [menu, setMenu] = useState<Row | null>(null);

  useReset(open, () => {
    setInput('');
    setMenu(null);
  });

  const prefix = /^[>#@]/.test(input) ? input[0] : '';
  const text = (prefix ? input.slice(1) : input).trim();
  const { data: tags } = useTool('list_tags', {}, { enabled: open && prefix === '#' });
  const { data: libraries } = useTool('list_libraries', {}, { enabled: open && prefix === '@' });
  const { data: found } = useTool(
    'search_files',
    { text, limit: 8 },
    { enabled: open && !prefix && text.length > 1 },
  );

  const commandRows = useMemo<Row[]>(
    () =>
      open
        ? commands
            .filter((c) => c.id !== 'palette' && (c.when?.() ?? true))
            .map((c) => ({
              id: c.id,
              text: `${c.title} ${c.id}`,
              label: c.title,
              icon: <Terminal className={icon} />,
              keys: c.keys,
              group: 'Commands',
              run: c.run,
            }))
        : [],
    [open],
  );

  const tagRows: Row[] = (tags ?? []).map((t) => ({
    id: `tag-${t.tag}`,
    text: t.tag,
    label: <TagChip tag={t.tag} count={t.count} />,
    icon: <Hash className={icon} />,
    group: 'Tags',
    run: () => useTabs.getState().open(patchQuery('', { tag: [t.tag] })),
    alt: {
      title: 'Add to this filter',
      run: () => setView({ tag: [...parseView(activeTab().query).tag, t.tag] }),
    },
  }));

  const folderRows: Row[] = (libraries ?? []).map((l) => ({
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
  }));

  const fileRows: Row[] = (found?.files ?? []).map((f) => ({
    id: `file-${f.id}`,
    text: `${f.name} ${text}`,
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
  }));

  const recentRows = text
    ? []
    : recent.flatMap((id) => {
        const row = commandRows.find((r) => r.id === id);
        return row ? [{ ...row, id: `recent-${id}`, group: 'Recent' }] : [];
      });

  const rows = menu
    ? [
        { ...menu, id: 'primary', label: 'Open', keys: 'enter', group: 'Actions' },
        ...(menu.alt
          ? [
              {
                ...menu,
                id: 'alt',
                label: menu.alt.title,
                keys: 'mod+enter',
                run: menu.alt.run,
                group: 'Actions',
              },
            ]
          : []),
      ]
    : prefix === '>'
      ? commandRows
      : prefix === '#'
        ? tagRows
        : prefix === '@'
          ? folderRows
          : [...recentRows, ...commandRows, ...fileRows];

  const groups = Map.groupBy(rows, (r) => r.group);

  const run = (row: Row, how: () => void = row.run) => {
    close();
    if (!row.id.startsWith('tag-') && !row.id.startsWith('f'))
      remember(row.id.replace('recent-', ''));
    how();
  };

  const current = rows.find((r) => r.id === value);

  return (
    <Dialog open={open} onClose={close} title="Command palette" bare>
      <Cmdk
        label="Command palette"
        value={value}
        onValueChange={setValue}
        filter={(id, search) => {
          const row = rows.find((r) => r.id === id);
          const needle = (prefix ? search.slice(1) : search).trim().toLowerCase();
          if (!needle || menu) return 1;
          return row?.text.toLowerCase().includes(needle) ? 1 : 0;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && current) {
            e.preventDefault();
            setMenu(menu ? null : current);
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && current?.alt) {
            e.preventDefault();
            run(current, current.alt.run);
          } else if (e.key === 'Escape' && menu) {
            e.preventDefault();
            e.stopPropagation();
            setMenu(null);
          }
        }}
        className="flex min-h-0 flex-col"
      >
        <Cmdk.Input
          value={input}
          onValueChange={setInput}
          placeholder="Search, or > commands, # tags, @ folders"
          className="h-10 w-full shrink-0 border-b bg-transparent px-3 text-lg outline-none placeholder:text-subtle"
        />
        <Cmdk.List className="max-h-[22rem] overflow-y-auto p-1">
          <Cmdk.Empty className="p-4 text-center text-sm text-subtle">Nothing found.</Cmdk.Empty>
          {[...groups].map(([group, items]) => (
            <Cmdk.Group key={group} heading={group}>
              {items.map((row) => (
                <Cmdk.Item
                  key={row.id}
                  value={row.id}
                  onSelect={() => run(row)}
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
        <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-xs text-subtle">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" /> Run
          </span>
          <span>{keyLabel('mod+enter')} Secondary</span>
          <span>Tab Actions</span>
        </footer>
      </Cmdk>
    </Dialog>
  );
}
