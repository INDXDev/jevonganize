/** The tabs of the Tags screen: all tags, review, names, and the largest facets. */
import { t } from '../i18n/index.ts';
import type { FacetInfo, TagNode } from '../../types.ts';
import { useTool } from '../api.ts';
import { cn, formatCount } from '../lib.ts';
import { setView, useView } from '../tabs.ts';
import { ENTITY_FACET } from './tags-names-state.ts';

/** How many facets get a tab of their own, the ones with the most files first. */
const FACET_TAB_COUNT = 3;

/** One tab of the heading. `tourId` becomes `data-tour="tags-section-<tourId>"`. */
function SectionTab(props: {
  label: string;
  active: boolean;
  count?: number;
  tourId: string;
  onClick: () => void;
}) {
  const { label, active, count, tourId, onClick } = props;
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      data-tour={`tags-section-${tourId}`}
      onClick={onClick}
      className={cn(
        'flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-subtle hover:bg-surface-2 hover:text-foreground',
        active && 'bg-soft text-foreground',
      )}
    >
      {label}
      {!!count && <span className="font-mono text-2xs">{formatCount(count)}</span>}
    </button>
  );
}

/** The facets that get a tab: most files first, apart from proper names, which have Names. */
function facetTabs(tree: TagNode[], facets: FacetInfo[]) {
  const titleById = new Map(facets.map((facet) => [facet.id, facet.title]));
  const facetRoots = tree.filter((node) => node.depth === 0 && node.facet !== ENTITY_FACET);
  const largestFirst = facetRoots.toSorted((a, b) => b.total - a.total);
  return largestFirst.slice(0, FACET_TAB_COUNT).map((root) => ({
    id: root.label,
    title: titleById.get(root.label) ?? root.label,
  }));
}

/** Shows a section, or the tree narrowed to a facet. Each clears the other. */
const showSection = (next: { section?: string; facet?: string }) =>
  setView({ section: next.section ?? null, facet: next.facet ?? null });

/** True when the section shows the tree. `organize` does: its drawer opens over the tree. */
export const isTreeSection = (section?: string) => section !== 'review' && section !== 'names';

/** The tabs: all tags, review, names, then a few facets, which filter the tree by `facet`. */
export function SectionTabs({ tree }: { tree: TagNode[] }) {
  const { section, facet } = useView();
  const { data: status } = useTool('status', {});
  const { data: facets = [] } = useTool('list_facets', {});
  const treeShown = isTreeSection(section);
  return (
    <nav
      aria-label={t('Tag sections')}
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
    >
      <SectionTab
        label={t('All tags')}
        tourId="all"
        active={treeShown && !facet}
        onClick={() => showSection({})}
      />
      <SectionTab
        label={t('Review (section)')}
        tourId="review"
        count={status?.reviews}
        active={section === 'review'}
        onClick={() => showSection({ section: 'review' })}
      />
      <SectionTab
        label={t('Names')}
        tourId="names"
        active={section === 'names'}
        onClick={() => showSection({ section: 'names' })}
      />
      {facetTabs(tree, facets).map((tab) => (
        <SectionTab
          key={tab.id}
          label={tab.title}
          tourId={`facet-${tab.id}`}
          active={treeShown && facet === tab.id}
          onClick={() => showSection({ facet: tab.id })}
        />
      ))}
    </nav>
  );
}
