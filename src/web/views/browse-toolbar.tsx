import { t } from '../i18n/index.ts';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronRight,
  FolderSync,
  LayoutGrid,
  List,
  Search,
  Sparkles,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { FileQuery, Library } from '../../types.ts';
import { scanFolder } from '../api.ts';
import { Button } from '../components/ui/button.tsx';
import { Select } from '../components/ui/field.tsx';
import { cn, shortPath } from '../lib.ts';
import { goTo, setView, useActions } from '../tabs.ts';
import { pathSep, sortOf, type View } from '../view-query.ts';
import { RefreshButton, RefreshTag } from './tag-refresh.tsx';
import { ViewMenu } from './view-menu.tsx';

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
  const root = libraries.find((library) => view.folder?.startsWith(library.path))?.path;
  const sep = pathSep(root ?? '/');
  const parts =
    root && view.folder ? view.folder.slice(root.length).split(sep).filter(Boolean) : [];
  const items = [crumb(t('All'), null, !root)];
  if (root) items.push(crumb(shortPath(root), root, !parts.length));
  const base = root?.replace(/[\\/]$/, '');
  parts.forEach((part, i) => {
    const folder = [base, ...parts.slice(0, i + 1)].join(sep);
    items.push(crumb(part, folder, i === parts.length - 1));
  });
  return (
    <nav aria-label={t('Folder')} className="flex min-w-0 items-center gap-1 font-mono text-xs">
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
  { value: 'kind', label: 'Kind' },
  { value: 'size', label: 'Size' },
  { value: 'relevance', label: 'Relevance' },
] as const;

function FilterInput({ view }: { view: View }) {
  const input = useRef<HTMLInputElement>(null);
  useActions({ filter: () => input.current?.focus() });
  return (
    <label className="flex h-6 min-w-24 flex-1 items-center gap-1.5 rounded-sm px-1.5 font-mono text-xs focus-within:bg-surface-2">
      <Search aria-hidden className="size-3 shrink-0 text-subtle" />
      <input
        ref={input}
        aria-label={t('Filter files')}
        placeholder={t('filter  /')}
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
  );
}

/** Refresh, when the list is filtered to exactly one tag. */
function TagRefresh({ view }: { view: View }) {
  const [open, setOpen] = useState(false);
  const [tag] = view.tag;
  if (view.tag.length !== 1 || !tag) return null;
  return (
    <>
      <RefreshButton tag={tag} label onClick={() => setOpen(true)} />
      {open && <RefreshTag tag={tag} onClose={() => setOpen(false)} />}
    </>
  );
}

function ToolbarActions({ view, query }: { view: View; query: FileQuery }) {
  const { sort, order } = sortOf(query);
  const desc = order === 'desc';
  const orderLabel = desc ? t('Descending') : t('Ascending');
  const grid = view.view === 'grid';
  return (
    <div className="flex items-center gap-0.5">
      <TagRefresh view={view} />
      <Button
        variant="ghost"
        className="h-6"
        data-tour="scan"
        title={t('Update the index from the disk. Local and free')}
        onClick={() => void scanFolder(view.folder)}
      >
        <FolderSync /> {t('Scan')}
      </Button>
      <Button
        variant="primary"
        className="mr-1 h-6"
        data-tour="organize"
        title={t('Choose facets, see the cost, then run')}
        onClick={() => goTo('organize')}
      >
        <Sparkles /> {t('Organize')}
      </Button>
      <Select
        label={t('Sort by')}
        className="h-6 w-24 border-transparent bg-transparent text-xs hover:bg-surface-2"
        value={sort}
        options={SORTS.map((option) => ({ ...option, label: t(option.label) }))}
        onChange={(next) => setView({ sort: next as View['sort'] })}
      />
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={orderLabel}
        title={orderLabel}
        onClick={() => setView({ order: desc ? 'asc' : 'desc' })}
      >
        {desc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
      </Button>
      <Button
        variant="ghost"
        icon
        className="size-6"
        aria-label={grid ? t('Switch to list') : t('Switch to grid')}
        title={t('Switch grid and list (v)')}
        onClick={() => setView({ view: grid ? 'list' : 'grid' })}
      >
        {grid ? <List /> : <LayoutGrid />}
      </Button>
      <ViewMenu mode={view.view} />
    </div>
  );
}

/** The title row of the file list: breadcrumbs, the filter, and the list's actions. */
export function Toolbar(props: { view: View; query: FileQuery; libraries: Library[] }) {
  const { view, query, libraries } = props;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Crumbs view={view} libraries={libraries} />
      <FilterInput view={view} />
      <ToolbarActions view={view} query={query} />
    </div>
  );
}
