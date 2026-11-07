import { t } from '../i18n/index.ts';
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { TagCount } from '../../types.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { setView } from '../tabs.ts';
import type { View } from '../view-query.ts';

/** How many tags a group shows before the rest fold under "more". */
const TAGS_SHOWN = 6;

/** The group for tags with no `facet:` prefix. */
const OTHER = 'Other';

/** A titled block of the sidebar. `tour` names it for the onboarding tour. */
export function SidebarGroup(props: { title: string; tour?: string; children: ReactNode }) {
  const { title, tour, children } = props;
  return (
    <section data-tour={tour} className="px-1.5 pb-3">
      <h3 className="label px-2 pb-1">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A click on a tag: one already filtering, either way, comes off; otherwise it is added, as a
 * required tag or, with Alt held, as an excluded one.
 */
function toggleTagFilter(e: MouseEvent, tag: string, view: View) {
  const isFiltering = view.tag.includes(tag) || view.not.includes(tag);
  if (isFiltering) {
    const without = (tags: string[]) => tags.filter((entry) => entry !== tag);
    setView({ tag: without(view.tag), not: without(view.not) });
    return;
  }
  setView(e.altKey ? { not: [...view.not, tag] } : { tag: [...view.tag, tag] });
}

function TagGroup({ title, tags, view }: { title: string; tags: TagCount[]; view: View }) {
  const [showAll, setShowAll] = useState(false);
  const visibleTags = showAll ? tags : tags.slice(0, TAGS_SHOWN);
  const foldedCount = tags.length - TAGS_SHOWN;
  return (
    <SidebarGroup title={title}>
      {visibleTags.map((entry) => (
        <TagChip
          key={entry.tag}
          tag={entry.tag}
          count={entry.count}
          row={{ checked: view.tag.includes(entry.tag) }}
          negated={view.not.includes(entry.tag)}
          onClick={(e) => toggleTagFilter(e, entry.tag, view)}
        />
      ))}
      {foldedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="px-2 text-xs text-subtle hover:text-foreground"
        >
          {showAll ? t('Fewer') : t('{count} more', { count: foldedCount })}
        </button>
      )}
    </SidebarGroup>
  );
}

/** Tags by facet, facets in order, with unprefixed tags last under "Other". */
function groupByFacet(tags: TagCount[]) {
  // The prefix rather than `facet`, so all `flag:` tags share one group.
  const facetOf = (entry: TagCount) => (entry.tag.includes(':') ? entry.tag.split(':')[0]! : OTHER);
  const byFacet = Map.groupBy(tags, facetOf);
  const otherTags = byFacet.get(OTHER);
  byFacet.delete(OTHER);
  const facetGroups = [...byFacet].toSorted(([a], [b]) => a.localeCompare(b));
  return otherTags ? [...facetGroups, [OTHER, otherTags] as const] : facetGroups;
}

/** One group of tag filters per facet. */
export function TagGroups({ tags, view }: { tags: TagCount[]; view: View }) {
  const facetGroups = useMemo(() => groupByFacet(tags), [tags]);
  return facetGroups.map(([facet, facetTags]) => (
    <TagGroup
      key={facet}
      title={facet === OTHER ? t('Other') : facet}
      tags={facetTags}
      view={view}
    />
  ));
}
