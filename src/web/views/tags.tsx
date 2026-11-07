/**
 * The Tags screen, which took in Organize, Review and Names. Section tabs pick what shows: the tag tree
 * with a detail pane, a facet of it, the review queue or proper names. Organize opens as a drawer.
 */
import { t } from '../i18n/index.ts';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTool } from '../api.ts';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { ScreenHeader } from '../components/screen-header.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/field.tsx';
import { formatCount } from '../lib.ts';
import { setView, useView } from '../tabs.ts';
import { OrganizeDrawer } from './organize-drawer.tsx';
import { TagDetail } from './tags-detail.tsx';
import { countTags, TagTree } from './tags-list.tsx';
import { planMove } from './tags-move.tsx';
import { Names } from './tags-names.tsx';
import { Review } from './tags-review.tsx';
import { isTreeSection, SectionTabs } from './tags-tabs.tsx';

/** The tree on the left and the selected tag on the right. A move or other change shows as a plan. */
function TagWorkspace({ filterText }: { filterText: string }) {
  const { folder, facet, tag } = useView();
  const { data: tree = [], isLoading, error } = useTool('list_tag_tree', { folder, facet });
  const [planId, setPlanId] = useState<string>();
  const { data: plan } = useTool('get_plan', { id: planId ?? '' }, { enabled: !!planId });
  return (
    <Panes id="tags" panes={['tag-list', 'tag-side']}>
      <Pane
        id="tag-list"
        minSize={320}
        loading={isLoading}
        error={error}
        empty={tree.length ? undefined : t('No tags match.')}
        title={t('Tags {count}', { count: formatCount(countTags(tree)) })}
      >
        <TagTree
          nodes={tree}
          filterText={filterText}
          selected={tag[0]}
          onMove={(from, parent) => void planMove(from, parent, setPlanId)}
        />
      </Pane>
      <Divider />
      <Pane id="tag-side" defaultSize="42%" minSize={300}>
        <div data-tour="tag-detail">
          <TagDetail tree={tree} plan={plan} onPlan={setPlanId} />
        </div>
      </Pane>
    </Panes>
  );
}

/** The right of the heading: the tree's filter box, when the tree shows, and Run organize. */
function HeaderActions(props: {
  showFilter: boolean;
  filterText: string;
  onFilterText: (text: string) => void;
}) {
  const { showFilter, filterText, onFilterText } = props;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      {showFilter && (
        <Input
          aria-label={t('Filter tags')}
          placeholder={t('Filter…')}
          className="h-6 w-44 text-sm"
          value={filterText}
          onChange={(e) => onFilterText(e.target.value)}
        />
      )}
      <Button variant="primary" className="h-6" onClick={() => setView({ section: 'organize' })}>
        <Sparkles /> {t('Run organize')}
      </Button>
    </span>
  );
}

/** Tags: the section tabs, a filter and Run organize on top, and the chosen section below. */
export function TagsScreen() {
  const { section, folder } = useView();
  // The tabs need every facet's root, so this tree ignores the facet filter the workspace applies.
  const { data: wholeTree = [] } = useTool('list_tag_tree', { folder });
  const [filterText, setFilterText] = useState('');
  const treeShown = isTreeSection(section);
  return (
    <>
      <ScreenHeader title={t('Tags')}>
        <SectionTabs tree={wholeTree} />
        <HeaderActions
          showFilter={treeShown}
          filterText={filterText}
          onFilterText={setFilterText}
        />
      </ScreenHeader>
      {section === 'review' && <Review />}
      {section === 'names' && <Names />}
      {treeShown && <TagWorkspace filterText={filterText} />}
      {section === 'organize' && <OrganizeDrawer onClose={() => setView({ section: null })} />}
    </>
  );
}
