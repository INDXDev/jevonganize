/** The detail pane of the Tags screen: the selected tag, where it sits, and what can be done to it. */
import { t } from '../i18n/index.ts';
import { ArrowUpToLine, Filter, FolderPlus, MoveRight, Pencil, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { Plan, TagNode, VocabularyEntry } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { FavoriteStar } from '../components/favorite-star.tsx';
import { TagColorPicker } from '../components/tag-color-picker.tsx';
import { Button } from '../components/ui/button.tsx';
import { formatCount } from '../lib.ts';
import { setView, useTabs, useView } from '../tabs.ts';
import { patchQuery } from '../view-query.ts';
import { RefreshButton, RefreshTag } from './tag-refresh.tsx';
import { TagChanges, toggleState } from './tags-changes.tsx';
import {
  ChildTags,
  RedundantParents,
  RelatedTags,
  TagReviews,
  type OnPlan,
} from './tags-detail-sections.tsx';
import { MoveDialog, planMove } from './tags-move.tsx';
import { Rename } from './tags-rename.tsx';

/** The node at `path`, searching the whole tree. */
function findNode(nodes: TagNode[], path: string): TagNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const below = findNode(node.children, path);
    if (below) return below;
  }
  return undefined;
}

/** One step of a breadcrumb. `path` selects that level; the facet has none. */
type Crumb = { label: string; path?: string };

/** The steps down to a tag: `topic:a/b` gives the facet topic, then `topic:a` and `topic:a/b`. */
function crumbsOf(tag: string): Crumb[] {
  const colon = tag.indexOf(':');
  const facetPrefix = colon < 0 ? '' : tag.slice(0, colon + 1);
  const parts = tag.slice(facetPrefix.length).split('/');
  const levels = parts.map((label, i) => {
    const path = facetPrefix + parts.slice(0, i + 1).join('/');
    return { label, path };
  });
  if (!facetPrefix) return levels;
  return [{ label: facetPrefix.slice(0, -1) }, ...levels];
}

/** A level above the tag is a link to it. The facet and the tag itself are plain text. */
function CrumbStep({ crumb, isLast }: { crumb: Crumb; isLast: boolean }) {
  const { label, path } = crumb;
  if (path && !isLast) {
    return (
      <button
        type="button"
        className="text-primary hover:underline"
        onClick={() => setView({ tag: [path] })}
      >
        {label}
      </button>
    );
  }
  return <span className={path ? 'font-medium' : 'text-subtle'}>{label}</span>;
}

/** Where the tag sits: `topic › finance › tax`, each level above it a link. */
function Breadcrumb({ tag }: { tag: string }) {
  const crumbs = crumbsOf(tag);
  return (
    <nav aria-label={t('Tag path')} className="flex flex-wrap items-center gap-1 text-sm">
      {crumbs.map((crumb, i) => (
        <Fragment key={crumb.path ?? ''}>
          {i > 0 && <span className="text-subtle">›</span>}
          <CrumbStep crumb={crumb} isLast={i === crumbs.length - 1} />
        </Fragment>
      ))}
    </nav>
  );
}

/** Plans the removal of `tag` from every file it is on in `folder`. */
async function proposeRemoval(tag: string, folder: string | undefined, onPlan: OnPlan) {
  const plan = await act('propose_changes', {
    query: { tags: [tag], folder },
    remove: [tag],
    title: t('Remove {tag}', { tag }),
  });
  if (plan) onPlan(plan.id);
}

/** The dialog open over the pane, if any. */
type OpenDialog = 'rename' | 'move' | 'refresh' | undefined;

/** The buttons for one tag. Each that changes files makes a plan first. */
function TagActions(props: {
  tag: string;
  node?: TagNode;
  entry?: VocabularyEntry;
  onDialog: (dialog: OpenDialog) => void;
  onPlan: OnPlan;
}) {
  const { tag, node, entry, onDialog, onPlan } = props;
  const { folder } = useView();
  const openTab = useTabs((s) => s.open);
  const isOnFiles = !node?.implicit;
  const makeFolder = () =>
    setView({ screen: 'folders', section: null, facet: null, tag: [], newfolder: tag });
  return (
    <div className="flex flex-wrap items-center gap-1">
      <TagColorPicker tag={tag} />
      {isOnFiles && <FavoriteStar tag={tag} className="size-6" />}
      <Button className="h-6" onClick={() => openTab(patchQuery('', { tag: [tag] }))}>
        <Filter /> {t('Show files')}
      </Button>
      <Button className="h-6" onClick={makeFolder}>
        <FolderPlus /> {t('Make a folder')}
      </Button>
      <Button variant="ghost" className="h-6" onClick={() => onDialog('rename')}>
        <Pencil /> {t('Rename or merge')}
      </Button>
      {node?.movable && (
        <Button variant="ghost" className="h-6" onClick={() => onDialog('move')}>
          <MoveRight /> {t('Move under…')}
        </Button>
      )}
      {node?.movable && node.depth > 1 && (
        <Button variant="ghost" className="h-6" onClick={() => void planMove(tag, null, onPlan)}>
          <ArrowUpToLine /> {t('Move to the top')}
        </Button>
      )}
      {isOnFiles && <RefreshButton tag={tag} label onClick={() => onDialog('refresh')} />}
      {isOnFiles && (
        <Button
          variant="ghost"
          className="h-6"
          onClick={() => void proposeRemoval(tag, folder, onPlan)}
        >
          <Trash2 /> {t('Remove from every file')}
        </Button>
      )}
      {entry && (
        <Button variant="ghost" className="h-6" onClick={() => toggleState(entry)}>
          {entry.state === 'active' ? t('Retire') : t('Activate')}
        </Button>
      )}
    </div>
  );
}

/** How many files carry the tag itself, and how many carry it or a tag under it. */
function CountsLine({ node }: { node: TagNode }) {
  return (
    <p className="font-mono text-xs text-subtle">
      {t('{direct} files with this tag · {total} with it or a tag under it', {
        direct: formatCount(node.direct),
        total: formatCount(node.total),
      })}
    </p>
  );
}

/**
 * The selected tag: its path, counts and actions, the last plan, its reviews, cleanup, children and
 * related tags. With no tag selected, the last plan and the open vocabularies.
 */
export function TagDetail(props: { tree: TagNode[]; plan?: Plan; onPlan: OnPlan }) {
  const { tree, plan, onPlan } = props;
  const { tag: tags, folder } = useView();
  const { data: vocabulary = [] } = useTool('list_vocabulary', {});
  const [dialog, setDialog] = useState<OpenDialog>();
  const tag = tags[0];
  if (!tag) return <TagChanges plan={plan} vocabulary={vocabulary} />;
  const node = findNode(tree, tag);
  const entry = vocabulary.find((e) => `${e.facet}:${e.value}` === tag);
  const close = () => setDialog(undefined);
  return (
    <div className="space-y-3 p-3">
      <Breadcrumb tag={tag} />
      {node && <CountsLine node={node} />}
      <TagActions tag={tag} node={node} entry={entry} onDialog={setDialog} onPlan={onPlan} />
      {plan && <Block plan={plan} />}
      <RedundantParents tag={tag} onPlan={onPlan} />
      <TagReviews tag={tag} onPlan={onPlan} />
      <ChildTags node={node} />
      <RelatedTags tag={tag} folder={folder} />
      {dialog === 'rename' && (
        <Rename tag={tag} hasChildren={!!node?.children.length} onClose={close} onPlan={onPlan} />
      )}
      {dialog === 'move' && node && (
        <MoveDialog node={node} tree={tree} onClose={close} onPlan={onPlan} />
      )}
      {dialog === 'refresh' && <RefreshTag tag={tag} onClose={close} />}
    </div>
  );
}
