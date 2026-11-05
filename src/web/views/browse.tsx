import { Command as Cmdk } from 'cmdk';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  Search,
} from 'lucide-react';
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { FileQuery, Library, TagCount } from '../../types.ts';
import { act, editTags, useTool } from '../api.ts';
import { FileList } from '../components/file-list.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Preview } from '../components/preview/index.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { Dialog } from '../components/ui/dialog.tsx';
import { Select } from '../components/ui/field.tsx';
import { cn, formatCount, shortPath } from '../lib.ts';
import { notify, setView, useActions, useView, useWindow } from '../tabs.ts';
import { toFileQuery, type View } from '../view-query.ts';
import { Inspector } from './inspector.tsx';

const TYPES = [
  ['PDF', 'application/pdf'],
  ['Images', 'image/*'],
  ['Audio', 'audio/*'],
  ['Video', 'video/*'],
  ['Text', 'text/*'],
] as const;

const STATUSES = [
  ['New', 'new'],
  ['Organized', 'organized'],
  ['Failed', 'failed'],
] as const;

const close = () => useWindow.setState({ overlay: null });

function Row(props: {
  on: boolean;
  onClick: () => void;
  count?: number;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      onClick={props.onClick}
      className={cn(
        'flex h-dense w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        props.on && 'bg-soft text-foreground',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', props.mono && 'font-mono text-xs')}>
        {props.children}
      </span>
      {props.count !== undefined && (
        <span className="font-mono text-xs text-subtle">{formatCount(props.count)}</span>
      )}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-1.5 pb-3">
      <h3 className="label px-2 pb-1">{title}</h3>
      {children}
    </section>
  );
}

function TagGroup({ title, tags, view }: { title: string; tags: TagCount[]; view: View }) {
  const [all, setAll] = useState(false);
  const pick = (e: MouseEvent, tag: string) => {
    const on = view.tag.includes(tag) || view.not.includes(tag);
    if (on)
      setView({ tag: view.tag.filter((t) => t !== tag), not: view.not.filter((t) => t !== tag) });
    else setView(e.altKey ? { not: [...view.not, tag] } : { tag: [...view.tag, tag] });
  };
  const shown = all ? tags : tags.slice(0, 6);
  return (
    <Group title={title}>
      {shown.map((t) => (
        <TagChip
          key={t.tag}
          tag={t.tag}
          count={t.count}
          row={{ checked: view.tag.includes(t.tag) }}
          negated={view.not.includes(t.tag)}
          onClick={(e) => pick(e, t.tag)}
        />
      ))}
      {tags.length > 6 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="px-2 text-xs text-subtle hover:text-foreground"
        >
          {all ? 'Fewer' : `${tags.length - 6} more`}
        </button>
      )}
    </Group>
  );
}

function Sidebar({ view, libraries }: { view: View; libraries: Library[] }) {
  const { data: tags } = useTool('list_tags', { folder: view.folder });
  const groups = useMemo(() => {
    // The prefix rather than `t.facet`, so all `flag:` tags share one group.
    const byFacet = Map.groupBy(tags ?? [], (t) =>
      t.tag.includes(':') ? t.tag.split(':')[0]! : 'Other',
    );
    const other = byFacet.get('Other');
    byFacet.delete('Other');
    const list = [...byFacet].toSorted(([a], [b]) => a.localeCompare(b));
    return other ? [...list, ['Other', other] as const] : list;
  }, [tags]);
  const files = libraries.reduce((n, l) => n + l.files, 0);
  return (
    <Pane id="sidebar" defaultSize="17%" minSize={180} maxSize="30%" className="pt-2.5">
      <Group title="Libraries">
        <Row on={!view.folder} count={files} onClick={() => setView({ folder: null, file: null })}>
          All
        </Row>
        {libraries.map((l) => (
          <Row
            key={l.path}
            mono
            on={view.folder === l.path}
            count={l.files}
            onClick={() => setView({ folder: l.path, file: null })}
          >
            {shortPath(l.path)}
          </Row>
        ))}
      </Group>
      {groups.map(([facet, list]) => (
        <TagGroup key={facet} title={facet} tags={list} view={view} />
      ))}
      <Group title="Type">
        {TYPES.map(([label, mime]) => (
          <Row
            key={mime}
            on={view.mime === mime}
            onClick={() => setView({ mime: view.mime === mime ? null : mime })}
          >
            {label}
          </Row>
        ))}
      </Group>
      <Group title="Status">
        {STATUSES.map(([label, status]) => (
          <Row
            key={status}
            on={view.status === status}
            onClick={() => setView({ status: view.status === status ? null : status })}
          >
            {label}
          </Row>
        ))}
      </Group>
    </Pane>
  );
}

const crumb = (text: string, folder: string | null, last: boolean) => (
  <button
    key={text}
    type="button"
    aria-current={last ? 'page' : undefined}
    onClick={() => setView({ folder })}
    className={cn('truncate hover:text-foreground', last ? 'text-foreground' : 'text-subtle')}
  >
    {text}
  </button>
);

function Crumbs({ view, libraries }: { view: View; libraries: Library[] }) {
  const root = libraries.find((l) => view.folder?.startsWith(l.path))?.path;
  const parts =
    root && view.folder ? view.folder.slice(root.length).split('/').filter(Boolean) : [];
  const items = [crumb('All', null, !root)];
  if (root) items.push(crumb(shortPath(root), root, !parts.length));
  parts.forEach((part, i) =>
    items.push(crumb(part, `${root}/${parts.slice(0, i + 1).join('/')}`, i === parts.length - 1)),
  );
  return (
    <nav aria-label="Folder" className="flex min-w-0 items-center gap-1 font-mono text-xs">
      {items.flatMap((item, i) => [
        i > 0 && <ChevronRight key={`s${i}`} className="size-3 shrink-0 text-subtle" />,
        item,
      ])}
    </nav>
  );
}

const SORTS = [
  { value: 'modified', label: 'Modified' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
  { value: 'relevance', label: 'Relevance' },
];

function Toolbar({ view, libraries }: { view: View; libraries: Library[] }) {
  const input = useRef<HTMLInputElement>(null);
  useActions({ filter: () => input.current?.focus() });
  const desc = (view.order ?? 'desc') === 'desc';
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Crumbs view={view} libraries={libraries} />
      <label className="flex h-6 min-w-24 flex-1 items-center gap-1.5 rounded-sm px-1.5 font-mono text-xs focus-within:bg-surface-2">
        <Search aria-hidden className="size-3 shrink-0 text-subtle" />
        <input
          ref={input}
          aria-label="Filter files"
          placeholder="filter  /"
          value={view.text ?? ''}
          onChange={(e) => setView({ text: e.target.value || null })}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            setView({ text: null });
            input.current?.blur();
          }}
          className="w-full bg-transparent outline-none placeholder:text-subtle"
        />
      </label>
      <div className="flex items-center gap-0.5">
        <Select
          label="Sort by"
          className="h-6 w-24 border-transparent bg-transparent text-xs hover:bg-surface-2"
          value={view.sort ?? 'modified'}
          options={SORTS}
          onChange={(sort) => setView({ sort: sort as View['sort'] })}
        />
        <Button
          variant="ghost"
          icon
          className="size-6"
          aria-label={desc ? 'Descending' : 'Ascending'}
          title={desc ? 'Descending' : 'Ascending'}
          onClick={() => setView({ order: desc ? 'asc' : 'desc' })}
        >
          {desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
        </Button>
        <Button
          variant="ghost"
          icon
          className="size-6"
          aria-label={view.view === 'grid' ? 'Switch to list' : 'Switch to grid'}
          title="Switch grid and list (v)"
          onClick={() => setView({ view: view.view === 'grid' ? 'list' : 'grid' })}
        >
          {view.view === 'grid' ? <List /> : <LayoutGrid />}
        </Button>
      </div>
    </div>
  );
}

const without = (list: string[], tag: string) => list.filter((t) => t !== tag);

function Filters({ view }: { view: View }) {
  if (!view.tag.length && !view.not.length && !view.mime && !view.status) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-surface-1 px-3 py-1.5">
      {view.tag.map((tag) => (
        <TagChip key={tag} tag={tag} onRemove={() => setView({ tag: without(view.tag, tag) })} />
      ))}
      {view.not.map((tag) => (
        <TagChip
          key={tag}
          tag={tag}
          negated
          onRemove={() => setView({ not: without(view.not, tag) })}
        />
      ))}
      {view.mime && <TagChip tag={`type:${view.mime}`} onRemove={() => setView({ mime: null })} />}
      {view.status && (
        <TagChip tag={`status:${view.status}`} onRemove={() => setView({ status: null })} />
      )}
      <button
        type="button"
        onClick={() => setView({ tag: [], not: [], mime: null, status: null })}
        className="ml-1 text-xs text-subtle hover:text-foreground"
      >
        Clear
      </button>
    </div>
  );
}

/** Adds a tag to the open file at once, or proposes it for a selection as a plan. */
function TagDialog({ query }: { query: FileQuery }) {
  const open = useWindow((s) => s.overlay === 'tag');
  const { file } = useView();
  const { data: tags } = useTool('list_tags', {}, { enabled: open });
  const [text, setText] = useState('');

  const add = async (tag: string) => {
    close();
    setText('');
    const { selection } = useWindow.getState();
    const ids = [...selection.ids];
    if (selection.all || ids.length > 1) {
      const scope = selection.all ? { query } : { file_ids: ids };
      const plan = await act('propose_changes', { ...scope, add: [tag], title: `Tag with ${tag}` });
      if (plan) useWindow.setState({ planId: plan.id });
    } else {
      const id = ids[0] ?? file;
      if (id) await editTags(id, { add: [tag] });
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Add a tag" bare>
      <Cmdk label="Add a tag">
        <Cmdk.Input
          value={text}
          onValueChange={setText}
          placeholder="Tag, such as topic:finance"
          className="h-10 w-full border-b bg-transparent px-3 font-mono text-md outline-none placeholder:text-subtle"
        />
        <Cmdk.List className="max-h-72 overflow-y-auto p-1">
          {text.trim() && (
            <Cmdk.Item
              value={`__new ${text}`}
              onSelect={() => void add(text.trim())}
              className="flex h-row items-center gap-2 rounded-sm px-2 text-sm data-[selected=true]:bg-soft"
            >
              <Plus className="size-3.5" /> Add “{text.trim()}”
            </Cmdk.Item>
          )}
          {tags?.map((t) => (
            <Cmdk.Item
              key={t.tag}
              value={t.tag}
              onSelect={() => void add(t.tag)}
              className="flex h-row items-center rounded-sm px-2 data-[selected=true]:bg-soft"
            >
              <TagChip tag={t.tag} count={t.count} />
            </Cmdk.Item>
          ))}
        </Cmdk.List>
      </Cmdk>
    </Dialog>
  );
}

function QuickPreview({ id }: { id?: number }) {
  const open = useWindow((s) => s.overlay === 'preview');
  const { data: file } = useTool('get_file', { id }, { enabled: open && !!id });
  return (
    <Dialog
      open={open && !!file}
      onClose={close}
      onKeyDown={(e) => e.key === ' ' && close()}
      title={file?.name ?? 'Preview'}
      className="top-[6vh] h-[86vh] max-h-none w-[62rem] max-w-[92vw]"
    >
      {file && (
        <div className="min-h-0 flex-1">
          <Preview file={file} large />
        </div>
      )}
    </Dialog>
  );
}

/** The file browser: sidebar, list and inspector. */
export function Browse() {
  const view = useView();
  const query = toFileQuery(view);
  const sidebar = useWindow((s) => s.sidebar);
  const inspector = useWindow((s) => s.inspector);
  const { data: libraries = [] } = useTool('list_libraries', {});

  useActions({
    switchView: () => setView({ view: view.view === 'grid' ? 'list' : 'grid' }),
    tag: () => {
      const { selection } = useWindow.getState();
      if (!view.file && !selection.all && !selection.ids.size) return notify('Select a file first');
      useWindow.setState({ overlay: 'tag' });
    },
    reveal: () => view.file && void act('reveal_file', { id: view.file }),
    clear: () => {
      const { selection } = useWindow.getState();
      if (selection.all || selection.ids.size)
        useWindow.setState({ selection: { ids: new Set(), all: false } });
      else if (view.file) setView({ file: null });
      else setView({ tag: [], not: [], mime: null, status: null, text: null });
    },
  });

  const panes = [sidebar && 'sidebar', 'list', inspector && 'inspector'].filter(
    Boolean,
  ) as string[];
  return (
    <>
      <Panes id="browse" panes={panes}>
        {sidebar && (
          <>
            <Sidebar view={view} libraries={libraries} />
            <Divider />
          </>
        )}
        <Pane
          id="list"
          minSize={320}
          title={<Toolbar view={view} libraries={libraries} />}
          subheader={<Filters view={view} />}
        >
          <FileList
            keyboard
            mode={view.view}
            label="Files"
            query={query}
            activeId={view.file}
            onOpen={(row) => setView({ file: row.id })}
            onCursor={(row) => view.file && setView({ file: row.id })}
            onSort={(sort) =>
              setView({
                sort,
                order: view.sort === sort && view.order !== 'asc' ? 'asc' : 'desc',
              })
            }
          />
        </Pane>
        {inspector && (
          <>
            <Divider />
            <Inspector />
          </>
        )}
      </Panes>
      <TagDialog query={query} />
      <QuickPreview id={view.file} />
    </>
  );
}
