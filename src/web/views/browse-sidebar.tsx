import { t } from '../i18n/index.ts';
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { Library, TagCount } from '../../types.ts';
import { useTool } from '../api.ts';
import { Pane } from '../components/pane.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { cn, formatCount, shortPath } from '../lib.ts';
import { setView } from '../tabs.ts';
import type { View } from '../view-query.ts';

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

function Group(props: { title: string; tour?: string; children: ReactNode }) {
  const { title, children } = props;
  return (
    <section data-tour={props.tour} className="px-1.5 pb-3">
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
      setView({
        tag: view.tag.filter((tagItem) => tagItem !== tag),
        not: view.not.filter((tagItem) => tagItem !== tag),
      });
    else setView(e.altKey ? { not: [...view.not, tag] } : { tag: [...view.tag, tag] });
  };
  const shown = all ? tags : tags.slice(0, 6);
  return (
    <Group title={title}>
      {shown.map((tagItem) => (
        <TagChip
          key={tagItem.tag}
          tag={tagItem.tag}
          count={tagItem.count}
          row={{ checked: view.tag.includes(tagItem.tag) }}
          negated={view.not.includes(tagItem.tag)}
          onClick={(e) => pick(e, tagItem.tag)}
        />
      ))}
      {tags.length > 6 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="px-2 text-xs text-subtle hover:text-foreground"
        >
          {all ? t('Fewer') : t('{count} more', { count: tags.length - 6 })}
        </button>
      )}
    </Group>
  );
}

function groupByFacet(tags: TagCount[]) {
  // The prefix rather than `t.facet`, so all `flag:` tags share one group.
  const byFacet = Map.groupBy(tags, (tagItem) =>
    tagItem.tag.includes(':') ? tagItem.tag.split(':')[0]! : 'Other',
  );
  const other = byFacet.get('Other');
  byFacet.delete('Other');
  const list = [...byFacet].toSorted(([a], [b]) => a.localeCompare(b));
  return other ? [...list, ['Other', other] as const] : list;
}

/** The left pane of the browser: libraries, tag groups, types and statuses. */
export function Sidebar({ view, libraries }: { view: View; libraries: Library[] }) {
  const { data: tags } = useTool('list_tags', { folder: view.folder });
  const groups = useMemo(() => groupByFacet(tags ?? []), [tags]);
  const files = libraries.reduce((total, library) => total + library.files, 0);
  return (
    <Pane id="sidebar" defaultSize="17%" minSize={180} maxSize="30%" className="pt-2.5">
      <Group title={t('Libraries')} tour="library">
        <Row on={!view.folder} count={files} onClick={() => setView({ folder: null, file: null })}>
          {t('All')}
        </Row>
        {libraries.map((library) => (
          <Row
            key={library.path}
            mono
            on={view.folder === library.path}
            count={library.files}
            onClick={() => setView({ folder: library.path, file: null })}
          >
            {shortPath(library.path)}
          </Row>
        ))}
      </Group>
      {groups.map(([facet, list]) => (
        <TagGroup
          key={facet}
          title={facet === 'Other' ? t('Other') : facet}
          tags={list}
          view={view}
        />
      ))}
      <Group title={t('Type')}>
        {TYPES.map(([label, mime]) => (
          <Row
            key={mime}
            on={view.mime === mime}
            onClick={() => setView({ mime: view.mime === mime ? null : mime })}
          >
            {t(label)}
          </Row>
        ))}
      </Group>
      <Group title={t('Status')}>
        {STATUSES.map(([label, status]) => (
          <Row
            key={status}
            on={view.status === status}
            onClick={() => setView({ status: view.status === status ? null : status })}
          >
            {t(label)}
          </Row>
        ))}
      </Group>
    </Pane>
  );
}
