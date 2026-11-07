import { t } from '../i18n/index.ts';
import { act, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane } from '../components/pane.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn, formatCount } from '../lib.ts';
import { setView } from '../tabs.ts';
import type { ReviewGroup } from './tags-review-state.ts';

/** Plans still waiting to be applied, newest first. */
function Plans() {
  const { data: plans = [] } = useTool('list_plans', { status: 'proposed' });
  if (!plans.length) return null;
  const newestFirst = plans.toSorted((a, b) => b.created_at - a.created_at);
  return (
    <section className="space-y-2 p-2.5">
      <h3 className="label">
        {t('Plans waiting')} {plans.length}
      </h3>
      {newestFirst.map((plan) => (
        <Block key={plan.id} plan={plan} />
      ))}
    </section>
  );
}

const CLEANUP_ROW = 'flex items-center gap-2 py-0.5';

/** A pair of tags so alike they are likely one, and the button that merges the first into the second. */
function MergeRow({ tags, files }: { tags: string[]; files: number }) {
  const [keptTag, mergedTag] = tags as [string, string];
  const merge = () => void act('rename_tag', { from: mergedTag, to: keptTag });
  return (
    <div className={cn(CLEANUP_ROW, 'flex-wrap')}>
      <TagChip tag={mergedTag} />
      <span className="text-xs text-subtle">≈</span>
      <TagChip tag={keptTag} />
      <Button variant="ghost" className="ml-auto h-6" onClick={merge}>
        {' '}
        {t('Merge')} {files}
      </Button>
    </div>
  );
}

/** Tags that look like mistakes: near duplicates, tags on too many files, and tags on one. */
function Cleanup() {
  const { data: report } = useTool('cleanup_report', {});
  if (!report) return null;
  const singleUseCount = report.single_use.length;
  return (
    <section className="space-y-1 border-t p-2.5">
      <h3 className="label">{t('Cleanup')}</h3>
      {report.near_duplicates.map(({ tags, files }) => (
        <MergeRow key={tags.join()} tags={tags} files={files} />
      ))}
      {report.over_broad.map((entry) => (
        <div key={entry.tag} className={CLEANUP_ROW}>
          <TagChip tag={entry.tag} count={entry.count} />
          <span className="text-xs text-subtle">{t('over-broad')}</span>
        </div>
      ))}
      {singleUseCount > 0 && (
        <p className="text-xs text-subtle">
          {t('{count} tags are on one file.', { count: singleUseCount })}
        </p>
      )}
    </section>
  );
}

/** A group in the queue: its tag, or "restore:" and the tag, and how many items it holds. */
function GroupButton({ group, isOpen }: { group: ReviewGroup; isOpen: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={isOpen}
      onClick={() => setView({ tag: [group.key] })}
      className={cn(
        'flex h-row w-full items-center gap-2 rounded-sm px-1.5 hover:bg-surface-2',
        isOpen && 'bg-soft',
      )}
    >
      <span className="flex min-w-0 flex-1">
        {group.isRestore ? (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {t('restore: {tag}', { tag: group.tag })}
          </span>
        ) : (
          <TagChip tag={group.tag} />
        )}
      </span>
      <span className="font-mono text-xs text-subtle">{group.items.length}</span>
    </button>
  );
}

/** The tags waiting, each a button that opens its group. */
export function QueuePane(props: {
  pending: number;
  groups: ReviewGroup[];
  openGroupIndex: number;
  loading: boolean;
  error: Error | null;
}) {
  const { pending, groups, openGroupIndex, loading, error } = props;
  const isEmpty = !groups.length && !loading;
  return (
    <Pane
      id="queue"
      title={t('Review · {count} pending', { count: formatCount(pending) })}
      defaultSize="30%"
      minSize={260}
      loading={loading}
      error={error}
    >
      <Plans />
      <section className="border-t p-2.5">
        <h3 className="label mb-1">{t('Tags')}</h3>
        {groups.map((group, index) => (
          <GroupButton key={group.key} group={group} isOpen={index === openGroupIndex} />
        ))}
        {isEmpty && <p className="text-xs text-subtle">{t('Nothing to decide.')}</p>}
      </section>
      <Cleanup />
    </Pane>
  );
}
