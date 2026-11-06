import { t } from '../i18n/index.ts';
import { useQueries } from '@tanstack/react-query';
import { Check, SkipForward, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FileRow, ReviewItem } from '../../types.ts';
import { act, call, resolveReviews, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { FileList } from '../components/file-list.tsx';
import { Divider, Pane, Panes } from '../components/pane.tsx';
import { Preview } from '../components/preview/index.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn, formatCount, keyLabel, useReset } from '../lib.ts';
import { setView, useActions, useView } from '../tabs.ts';

type Group = { key: string; tag: string; restore: boolean; items: ReviewItem[] };

/** Adjacent items with one tag form a group. Restores come last. */
function groupItems(items: ReviewItem[]) {
  const groups: Group[] = [];
  for (const item of items) {
    const restore = item.kind === 'restore';
    const key = `${restore ? 'restore:' : ''}${item.tag}`;
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, tag: item.tag, restore, items: [item] });
  }
  return groups.toSorted((a, b) => Number(a.restore) - Number(b.restore));
}

function Plans() {
  const { data: plans = [] } = useTool('list_plans', { status: 'proposed' });
  if (!plans.length) return null;
  return (
    <section className="space-y-2 p-2.5">
      <h3 className="label">
        {t('Plans waiting')} {plans.length}
      </h3>
      {plans
        .toSorted((a, b) => b.created_at - a.created_at)
        .map((plan) => (
          <Block key={plan.id} plan={plan} />
        ))}
    </section>
  );
}

function Cleanup() {
  const { data } = useTool('cleanup_report', {});
  if (!data) return null;
  const row = 'flex items-center gap-2 py-0.5';
  return (
    <section className="space-y-1 border-t p-2.5">
      <h3 className="label">{t('Cleanup')}</h3>
      {data.near_duplicates.map(({ tags, files }) => {
        const [to, from] = tags as [string, string];
        return (
          <div key={tags.join()} className={cn(row, 'flex-wrap')}>
            <TagChip tag={from} />
            <span className="text-xs text-subtle">≈</span>
            <TagChip tag={to} />
            <Button
              variant="ghost"
              className="ml-auto h-6"
              onClick={() => void act('rename_tag', { from, to })}
            >
              {' '}
              {t('Merge')} {files}
            </Button>
          </div>
        );
      })}
      {data.over_broad.map((entry) => (
        <div key={entry.tag} className={row}>
          <TagChip tag={entry.tag} count={entry.count} />
          <span className="text-xs text-subtle">{t('over-broad')}</span>
        </div>
      ))}
      {data.single_use.length > 0 && (
        <p className="text-xs text-subtle">
          {t('{count} tags are on one file.', { count: data.single_use.length })}
        </p>
      )}
    </section>
  );
}

/** Keys and counts for the session, under the three panes. */
function Bar({ done }: { done: { accepted: number; rejected: number } }) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t bg-surface-1 px-3 font-mono text-xs text-subtle">
      <span>
        {t('{accepted} accepted · {rejected} rejected', {
          accepted: done.accepted,
          rejected: done.rejected,
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

/** The tags waiting, each a button that opens its group. */
function QueuePane(props: {
  pending: number;
  groups: Group[];
  openIndex: number;
  loading: boolean;
  error: Error | null;
}) {
  const { pending, groups, openIndex, loading, error } = props;
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
        {groups.map((g, i) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={i === openIndex}
            onClick={() => setView({ tag: [g.key] })}
            className={cn(
              'flex h-row w-full items-center gap-2 rounded-sm px-1.5 hover:bg-surface-2',
              i === openIndex && 'bg-soft',
            )}
          >
            <span className="flex min-w-0 flex-1">
              {g.restore ? (
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {t('restore: {tag}', { tag: g.tag })}
                </span>
              ) : (
                <TagChip tag={g.tag} />
              )}
            </span>
            <span className="font-mono text-xs text-subtle">{g.items.length}</span>
          </button>
        ))}
        {!groups.length && !loading && (
          <p className="text-xs text-subtle">{t('Nothing to decide.')}</p>
        )}
      </section>
      <Cleanup />
    </Pane>
  );
}

/** The files of the open group, with their confidence. */
function GroupPane(props: {
  group?: Group;
  queueEmpty: boolean;
  rows: FileRow[];
  activeId?: number;
  onOpen: (row: FileRow) => void;
  onDecideAll: (accept: boolean) => void;
}) {
  const { group, queueEmpty, rows, activeId, onOpen, onDecideAll } = props;
  const confidence = new Map(group?.items.map((r) => [r.file_id, r.confidence]));
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
            {confidence.get(row.id)?.toFixed(2) ?? t('Not available')}
          </span>
        )}
      />
    </Pane>
  );
}

/** One suggestion: the preview, why it was made, and the decision. */
function ItemPane(props: {
  item?: ReviewItem;
  file?: FileRow;
  onDecide: (ids: number[], accept: boolean) => void;
  onSkip: () => void;
}) {
  const { item, file, onDecide, onSkip } = props;
  return (
    <Pane id="item" defaultSize="28%" minSize={260} title={file?.name ?? t('Item')}>
      {item && file && (
        <>
          <div className="h-64 overflow-hidden border-b bg-surface-2">
            <Preview file={file} />
          </div>
          <div className="space-y-3 p-3">
            <div>
              <h3 className="label mb-1">{t('Why')}</h3>
              <p className="text-sm text-muted-foreground">
                {item.kind === 'restore'
                  ? t('This tag was on the file before it was saved.')
                  : item.reason}
              </p>
            </div>
            <TagChip tag={item.tag} confidence={item.confidence} />
            <div className="flex gap-1.5">
              <Button variant="primary" onClick={() => onDecide([item.id], true)}>
                <Check /> {t('Accept')} <span className="font-mono text-2xs opacity-70">A</span>
              </Button>
              <Button onClick={() => onDecide([item.id], false)}>
                <X /> {t('Reject')} <span className="kbd">R</span>
              </Button>
              <Button variant="ghost" onClick={onSkip}>
                <SkipForward /> {t('Skip')} <span className="kbd">S</span>
              </Button>
            </div>
          </div>
        </>
      )}
    </Pane>
  );
}

/** Session counts, and the call that sends a decision to the server. */
function useDecisions() {
  const [done, setDone] = useState({ accepted: 0, rejected: 0 });
  const decide = (ids: number[], accept: boolean) => {
    setDone((d) => ({
      accepted: d.accepted + (accept ? ids.length : 0),
      rejected: d.rejected + (accept ? 0 : ids.length),
    }));
    void resolveReviews(ids, accept);
  };
  return { done, decide };
}

// shortcut: review items carry only a file id, so names load per file, capped at 200 per group.
function useGroupFiles(openItems: ReviewItem[]) {
  const files = useQueries({
    queries: openItems.slice(0, 200).map((r) => ({
      queryKey: ['get_file', { id: r.file_id }],
      queryFn: () => call('get_file', { id: r.file_id }),
    })),
  });
  return files.flatMap((f) => (f.data ? [f.data] : []));
}

/** Which group and item are open. The group lives in the URL, the item in this hook. */
function useReviewCursor(groups: Group[]) {
  const view = useView();
  const [index, setIndex] = useState(0);
  const openIndex = Math.max(
    0,
    groups.findIndex((g) => g.key === view.tag[0]),
  );
  const group = groups[openIndex];
  const openItems = group?.items ?? [];
  const item = openItems[Math.min(index, openItems.length - 1)];

  useReset(group?.key, () => setIndex(0));

  const nextItem = () => setIndex((i) => Math.min(openItems.length - 1, i + 1));
  const prevItem = () => setIndex((i) => Math.max(0, i - 1));
  const openFile = (row: FileRow) => setIndex(openItems.findIndex((r) => r.file_id === row.id));
  const moveGroup = (delta: number) => {
    const next = groups[Math.min(groups.length - 1, Math.max(0, openIndex + delta))];
    if (next) setView({ tag: [next.key] });
  };
  return { openIndex, group, openItems, item, nextItem, prevItem, openFile, moveGroup };
}

/** Review: plans waiting, grouped suggestions, and one item at a time with a preview. */
export function Review() {
  const { data: items, isLoading, error } = useTool('list_reviews', { limit: 5000 });
  const groups = useMemo(() => groupItems(items ?? []), [items]);
  const { done, decide } = useDecisions();
  const cursor = useReviewCursor(groups);
  const { item, nextItem } = cursor;
  const rows = useGroupFiles(cursor.openItems);
  const file = rows.find((r) => r.id === item?.file_id);

  const groupIds = cursor.openItems.map((r) => r.id);
  const decideAll = (accept: boolean) => decide(groupIds, accept);
  useActions({
    down: nextItem,
    up: cursor.prevItem,
    nextGroup: () => cursor.moveGroup(1),
    prevGroup: () => cursor.moveGroup(-1),
    accept: () => item && decide([item.id], true),
    reject: () => item && decide([item.id], false),
    skip: nextItem,
    acceptAll: () => groupIds.length && decideAll(true),
    rejectAll: () => groupIds.length && decideAll(false),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panes id="review" panes={['queue', 'group', 'item']}>
        <QueuePane
          pending={items?.length ?? 0}
          groups={groups}
          openIndex={cursor.openIndex}
          loading={isLoading}
          error={error}
        />
        <Divider />
        <GroupPane
          group={cursor.group}
          queueEmpty={!groups.length}
          rows={rows}
          activeId={item?.file_id}
          onOpen={cursor.openFile}
          onDecideAll={decideAll}
        />
        <Divider />
        <ItemPane item={item} file={file} onDecide={decide} onSkip={nextItem} />
      </Panes>
      <Bar done={done} />
    </div>
  );
}
