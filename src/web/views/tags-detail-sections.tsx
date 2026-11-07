/** The parts of a tag's detail pane below its actions: reviews, cleanup, children and related tags. */
import { t } from '../i18n/index.ts';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TagNode } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { formatCount } from '../lib.ts';
import { setView } from '../tabs.ts';
import { useGroupFiles } from './tags-review-state.ts';

/** Takes the id of a plan an action made, to show it as a block. */
export type OnPlan = (id: string) => void;

/** How many of a tag's review items the pane lists. The Review section has them all. */
const REVIEWS_SHOWN = 50;

/** How many related tags the pane offers. */
const RELATED_SHOWN = 8;

const selectTag = (tag: string) => setView({ tag: [tag] });

/** A titled part of the pane, with optional buttons beside the title. */
function Part(props: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <div className="flex items-center gap-1.5">
        <h3 className="label mr-auto">{props.title}</h3>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

/**
 * The tag's review items, each with accept and reject. Accepting makes a plan that waits as a block,
 * unlike the Review section, where the key press is the approval.
 */
export function TagReviews({ tag, onPlan }: { tag: string; onPlan: OnPlan }) {
  const { data: items = [] } = useTool('list_reviews', { tag, limit: REVIEWS_SHOWN });
  const files = new Map(useGroupFiles(items).map((row) => [row.id, row.name]));
  if (!items.length) return null;
  const decide = async (ids: number[], accept: boolean) => {
    const plan = await act('resolve_reviews', { ids, accept });
    if (plan?.status === 'proposed') onPlan(plan.id);
  };
  const allIds = items.map((item) => item.id);
  const decideAll = (
    <>
      <Button variant="ghost" className="h-6" onClick={() => void decide(allIds, false)}>
        {t('Reject all')}
      </Button>
      <Button variant="ghost" className="h-6" onClick={() => void decide(allIds, true)}>
        {t('Accept all')}
      </Button>
    </>
  );
  return (
    <Part title={t('To review {count}', { count: formatCount(items.length) })} actions={decideAll}>
      <ul className="divide-y rounded-md border">
        {items.map((item) => {
          const name = files.get(item.file_id) ?? String(item.file_id);
          return (
            <li key={item.id} className="flex h-row items-center gap-2 px-2">
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <span className="font-mono text-xs text-subtle">
                {item.confidence?.toFixed(2) ?? t('Not available')}
              </span>
              <Button
                variant="ghost"
                icon
                className="size-6"
                aria-label={t('Accept {name}', { name })}
                onClick={() => void decide([item.id], true)}
              >
                <Check />
              </Button>
              <Button
                variant="ghost"
                icon
                className="size-6"
                aria-label={t('Reject {name}', { name })}
                onClick={() => void decide([item.id], false)}
              >
                <X />
              </Button>
            </li>
          );
        })}
      </ul>
    </Part>
  );
}

/** Parents carried next to this tag, or next to a tag under it, that add nothing. One click plans their removal. */
export function RedundantParents({ tag, onPlan }: { tag: string; onPlan: OnPlan }) {
  const { data: report } = useTool('cleanup_report', {});
  const pairs = report?.redundant_parents.filter((p) => p.tag === tag || p.parent === tag) ?? [];
  if (!pairs.length) return null;
  const removeParent = async (pair: (typeof pairs)[number]) => {
    const plan = await act('propose_changes', {
      query: { tags: [pair.tag] },
      remove: [pair.parent],
      title: t('Remove {tag}', { tag: pair.parent }),
    });
    if (plan) onPlan(plan.id);
  };
  return (
    <Part title={t('{count} redundant parents', { count: pairs.length })}>
      {pairs.map((pair) => (
        <div key={`${pair.tag} ${pair.parent}`} className="flex flex-wrap items-center gap-1.5">
          <TagChip tag={pair.parent} />
          <span className="text-xs text-subtle">
            {t('is redundant on {count} files with', { count: formatCount(pair.files) })}
          </span>
          <TagChip tag={pair.tag} />
          <Button variant="ghost" className="ml-auto h-6" onClick={() => void removeParent(pair)}>
            {t('Remove the parent')}
          </Button>
        </div>
      ))}
    </Part>
  );
}

/** The levels right under this tag, each with its total. */
export function ChildTags({ node }: { node?: TagNode }) {
  if (!node?.children.length) return null;
  return (
    <Part title={t('Under it')}>
      <ul className="divide-y rounded-md border">
        {node.children.map((child) => (
          <li key={child.path}>
            <button
              type="button"
              className="flex h-row w-full items-center gap-2 px-2 text-left text-sm hover:bg-surface-2"
              onClick={() => selectTag(child.path)}
            >
              <span className={child.implicit ? 'flex-1 italic' : 'flex-1'}>{child.label}</span>
              <span className="font-mono text-xs text-subtle">{formatCount(child.total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Part>
  );
}

/** Tags often on the same files, which would narrow a search for this one. */
export function RelatedTags({ tag, folder }: { tag: string; folder?: string }) {
  const input = { tags: [tag], tag_match: 'all' as const, folder, limit: RELATED_SHOWN };
  const { data } = useTool('suggest_vfolder_tags', input);
  const related = data?.suggestions.filter((entry) => entry.reason === 'narrows') ?? [];
  if (!related.length) return null;
  return (
    <Part title={t('Often with it')}>
      <div className="flex flex-wrap gap-1">
        {related.map((entry) => (
          <TagChip
            key={entry.tag}
            tag={entry.tag}
            count={entry.with_rule}
            onClick={() => selectTag(entry.tag)}
          />
        ))}
      </div>
    </Part>
  );
}
