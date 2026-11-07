import { t } from '../i18n/index.ts';
import { useMemo } from 'react';
import type { FileRow } from '../../types.ts';
import { useTool } from '../api.ts';
import { FileList } from '../components/file-list.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { keyLabel } from '../lib.ts';
import { useActions } from '../tabs.ts';
import { ItemPane, type Decide } from './tags-review-item.tsx';
import { QueuePane } from './tags-review-queue.tsx';
import {
  groupByTag,
  useDecisions,
  useGroupFiles,
  type DecisionCounts,
  type ReviewGroup,
} from './tags-review-state.ts';
import { useReviewCursor } from './tags-review-cursor.ts';

/** Keys and counts for the session, under the three panes. */
function SessionBar({ counts }: { counts: DecisionCounts }) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t bg-surface-1 px-3 font-mono text-xs text-subtle">
      <span>
        {t('{accepted} accepted · {rejected} rejected', {
          accepted: counts.accepted,
          rejected: counts.rejected,
        })}
      </span>
      <span className="flex gap-4">
        <span>{t('j k move')}</span>
        <span>{t('[ ] group')}</span>
        <span>{t('a r s decide')}</span>
        <span>{t('{shortcut} all', { shortcut: keyLabel('shift+a') })}</span>
      </span>
    </div>
  );
}

/** The files of the open group, with their confidence. */
function GroupPane(props: {
  group?: ReviewGroup;
  queueEmpty: boolean;
  rows: FileRow[];
  activeId?: number;
  onOpen: (row: FileRow) => void;
  onDecideAll: (accept: boolean) => void;
}) {
  const { group, queueEmpty, rows, activeId, onOpen, onDecideAll } = props;
  const confidenceByFile = new Map(group?.items.map((entry) => [entry.file_id, entry.confidence]));
  const decideAllButtons = group && (
    <>
      <Button variant="ghost" onClick={() => onDecideAll(false)}>
        {t('Reject all')}
      </Button>
      <Button variant="primary" onClick={() => onDecideAll(true)}>
        {t('Accept all')}
        <span className="font-mono text-2xs opacity-70">{keyLabel('shift+a')}</span>
      </Button>
    </>
  );
  return (
    <Pane
      id="group"
      minSize={300}
      className="p-1.5"
      title={group && <TagChip tag={group.tag} count={group.items.length} />}
      actions={decideAllButtons}
      empty={queueEmpty ? t('The queue is empty.') : undefined}
    >
      <FileList
        mode="compact"
        label={t('Files in this group')}
        rows={rows}
        activeId={activeId}
        onOpen={onOpen}
        renderTrailing={(row) => (
          <span className="font-mono text-xs text-muted-foreground">
            {confidenceByFile.get(row.id)?.toFixed(2) ?? t('Not available')}
          </span>
        )}
      />
    </Pane>
  );
}

/** The review keys: move between items and groups, and decide one item or the whole group. */
function useReviewShortcuts(cursor: ReturnType<typeof useReviewCursor>, decide: Decide) {
  const { openItem, nextItem } = cursor;
  const groupIds = cursor.openItems.map((entry) => entry.id);
  const decideAll = (accept: boolean) => decide(groupIds, accept);
  useActions({
    down: nextItem,
    up: cursor.prevItem,
    nextGroup: () => cursor.stepGroup(1),
    prevGroup: () => cursor.stepGroup(-1),
    accept: () => openItem && decide([openItem.id], true),
    reject: () => openItem && decide([openItem.id], false),
    skip: nextItem,
    acceptAll: () => groupIds.length && decideAll(true),
    rejectAll: () => groupIds.length && decideAll(false),
  });
  return decideAll;
}

/** Review: plans waiting, grouped suggestions, and one item at a time with a preview. */
export function Review() {
  const { data: items, isLoading, error } = useTool('list_reviews', { limit: 5000 });
  const groups = useMemo(() => groupByTag(items ?? []), [items]);
  const { counts, decide } = useDecisions();
  const cursor = useReviewCursor(groups);
  const { openItem, nextItem } = cursor;
  const rows = useGroupFiles(cursor.openItems);
  const file = rows.find((row) => row.id === openItem?.file_id);

  const decideAll = useReviewShortcuts(cursor, decide);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panes id="review" panes={['queue', 'group', 'item']}>
        <QueuePane
          pending={items?.length ?? 0}
          groups={groups}
          openGroupIndex={cursor.openGroupIndex}
          loading={isLoading}
          error={error}
        />
        <Divider />
        <GroupPane
          group={cursor.openGroup}
          queueEmpty={!groups.length}
          rows={rows}
          activeId={openItem?.file_id}
          onOpen={cursor.openItemOfFile}
          onDecideAll={decideAll}
        />
        <Divider />
        <ItemPane item={openItem} file={file} onDecide={decide} onSkip={nextItem} />
      </Panes>
      <SessionBar counts={counts} />
    </div>
  );
}
