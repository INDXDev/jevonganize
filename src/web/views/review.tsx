import { useQueries } from '@tanstack/react-query';
import { Check, SkipForward, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReviewItem } from '../../types.ts';
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
      <h3 className="label">Plans waiting {plans.length}</h3>
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
      <h3 className="label">Cleanup</h3>
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
              Merge {files}
            </Button>
          </div>
        );
      })}
      {data.over_broad.map((t) => (
        <div key={t.tag} className={row}>
          <TagChip tag={t.tag} count={t.count} />
          <span className="text-xs text-subtle">over-broad</span>
        </div>
      ))}
      {data.single_use.length > 0 && (
        <p className="text-xs text-subtle">{data.single_use.length} tags are on one file.</p>
      )}
    </section>
  );
}

/** Keys and counts for the session, under the three panes. */
function Bar({ done }: { done: { accepted: number; rejected: number } }) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-t bg-surface-1 px-3 font-mono text-xs text-subtle">
      <span>
        {done.accepted} accepted · {done.rejected} rejected
      </span>
      <span className="flex gap-4">
        <span>j k move</span>
        <span>[ ] group</span>
        <span>a r s decide</span>
        <span>{keyLabel('shift+a')} all</span>
      </span>
    </div>
  );
}

/** Review: plans waiting, grouped suggestions, and one item at a time with a preview. */
export function Review() {
  const view = useView();
  const { data: items, isLoading, error } = useTool('list_reviews', { limit: 5000 });
  const groups = useMemo(() => groupItems(items ?? []), [items]);
  const [done, setDone] = useState({ accepted: 0, rejected: 0 });
  const [index, setIndex] = useState(0);

  const at = Math.max(
    0,
    groups.findIndex((g) => g.key === view.tag[0]),
  );
  const group = groups[at];
  const list = group?.items ?? [];
  const item = list[Math.min(index, list.length - 1)];

  useReset(group?.key, () => setIndex(0));

  // shortcut: review items carry only a file id, so names load per file, capped at 200 per group.
  const files = useQueries({
    queries: list.slice(0, 200).map((r) => ({
      queryKey: ['get_file', { id: r.file_id }],
      queryFn: () => call('get_file', { id: r.file_id }),
    })),
  });
  const rows = files.flatMap((f) => (f.data ? [f.data] : []));
  const file = rows.find((r) => r.id === item?.file_id);

  const decide = (ids: number[], accept: boolean) => {
    setDone((d) => ({
      accepted: d.accepted + (accept ? ids.length : 0),
      rejected: d.rejected + (accept ? 0 : ids.length),
    }));
    void resolveReviews(ids, accept);
  };
  const go = (delta: number) => {
    const next = groups[Math.min(groups.length - 1, Math.max(0, at + delta))];
    if (next) setView({ tag: [next.key] });
  };
  const all = list.map((r) => r.id);
  useActions({
    down: () => setIndex((i) => Math.min(list.length - 1, i + 1)),
    up: () => setIndex((i) => Math.max(0, i - 1)),
    nextGroup: () => go(1),
    prevGroup: () => go(-1),
    accept: () => item && decide([item.id], true),
    reject: () => item && decide([item.id], false),
    skip: () => setIndex((i) => Math.min(list.length - 1, i + 1)),
    acceptAll: () => all.length && decide(all, true),
    rejectAll: () => all.length && decide(all, false),
  });

  const confidence = new Map(list.map((r) => [r.file_id, r.confidence]));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panes id="review" panes={['queue', 'group', 'item']}>
        <Pane
          id="queue"
          title={`Review · ${formatCount(items?.length ?? 0)} pending`}
          defaultSize="30%"
          minSize={260}
          loading={isLoading}
          error={error}
        >
          <Plans />
          <section className="border-t p-2.5">
            <h3 className="label mb-1">Tags</h3>
            {groups.map((g, i) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={i === at}
                onClick={() => setView({ tag: [g.key] })}
                className={cn(
                  'flex h-row w-full items-center gap-2 rounded-sm px-1.5 hover:bg-surface-2',
                  i === at && 'bg-soft',
                )}
              >
                <span className="flex min-w-0 flex-1">
                  {g.restore ? (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      restore: {g.tag}
                    </span>
                  ) : (
                    <TagChip tag={g.tag} />
                  )}
                </span>
                <span className="font-mono text-xs text-subtle">{g.items.length}</span>
              </button>
            ))}
            {!groups.length && !isLoading && (
              <p className="text-xs text-subtle">Nothing to decide.</p>
            )}
          </section>
          <Cleanup />
        </Pane>
        <Divider />
        <Pane
          id="group"
          minSize={300}
          className="p-1.5"
          title={group && <TagChip tag={group.tag} count={list.length} />}
          actions={
            group && (
              <>
                <Button variant="ghost" onClick={() => decide(all, false)}>
                  Reject all
                </Button>
                <Button variant="primary" onClick={() => decide(all, true)}>
                  Accept all{' '}
                  <span className="font-mono text-2xs opacity-70">{keyLabel('shift+a')}</span>
                </Button>
              </>
            )
          }
          empty={groups.length ? undefined : 'The queue is empty.'}
        >
          <FileList
            mode="compact"
            label="Files in this group"
            rows={rows}
            activeId={item?.file_id}
            onOpen={(row) => setIndex(list.findIndex((r) => r.file_id === row.id))}
            renderTrailing={(row) => (
              <span className="font-mono text-xs text-muted-foreground">
                {confidence.get(row.id)?.toFixed(2) ?? 'n/a'}
              </span>
            )}
          />
        </Pane>
        <Divider />
        <Pane id="item" defaultSize="28%" minSize={260} title={file?.name ?? 'Item'}>
          {item && file && (
            <>
              <div className="h-64 overflow-hidden border-b bg-surface-2">
                <Preview file={file} />
              </div>
              <div className="space-y-3 p-3">
                <div>
                  <h3 className="label mb-1">Why</h3>
                  <p className="text-sm text-muted-foreground">
                    {item.kind === 'restore'
                      ? 'This tag was on the file before it was saved.'
                      : item.reason}
                  </p>
                </div>
                <TagChip tag={item.tag} confidence={item.confidence} />
                <div className="flex gap-1.5">
                  <Button variant="primary" onClick={() => decide([item.id], true)}>
                    <Check /> Accept <span className="font-mono text-2xs opacity-70">A</span>
                  </Button>
                  <Button onClick={() => decide([item.id], false)}>
                    <X /> Reject <span className="kbd">R</span>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setIndex((i) => Math.min(list.length - 1, i + 1))}
                  >
                    <SkipForward /> Skip <span className="kbd">S</span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </Pane>
      </Panes>
      <Bar done={done} />
    </div>
  );
}
