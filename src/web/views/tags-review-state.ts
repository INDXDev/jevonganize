import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import type { FileRow, ReviewItem } from '../../types.ts';
import { call, resolveReviews } from '../api.ts';

/** Suggestions of one tag, or restores of one tag. `key` tells the two apart and names it in the URL. */
export type ReviewGroup = { key: string; tag: string; isRestore: boolean; items: ReviewItem[] };

/** How many files a group loads names for, as each one is a request of its own. */
const GROUP_FILE_LIMIT = 200;

/** Adjacent items with one tag form a group. Restores come last. */
export function groupByTag(items: ReviewItem[]): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  for (const item of items) {
    const isRestore = item.kind === 'restore';
    const groupKey = isRestore ? `restore:${item.tag}` : item.tag;
    const lastGroup = groups.at(-1);
    if (lastGroup?.key === groupKey) lastGroup.items.push(item);
    else groups.push({ key: groupKey, tag: item.tag, isRestore, items: [item] });
  }
  const restoresLast = (a: ReviewGroup, b: ReviewGroup) =>
    Number(a.isRestore) - Number(b.isRestore);
  return groups.toSorted(restoresLast);
}

/** The decisions made this session, as counts. */
export type DecisionCounts = { accepted: number; rejected: number };

/** Session counts, and the call that sends a decision to the server. */
export function useDecisions() {
  const [counts, setCounts] = useState<DecisionCounts>({ accepted: 0, rejected: 0 });
  const decide = (ids: number[], accept: boolean) => {
    setCounts((before) => ({
      accepted: before.accepted + (accept ? ids.length : 0),
      rejected: before.rejected + (accept ? 0 : ids.length),
    }));
    void resolveReviews(ids, accept);
  };
  return { counts, decide };
}

/** The files of a group's items. Review items carry only a file id, so each file loads alone. */
export function useGroupFiles(openItems: ReviewItem[]): FileRow[] {
  const fileQueries = useQueries({
    queries: openItems.slice(0, GROUP_FILE_LIMIT).map((item) => ({
      queryKey: ['get_file', { id: item.file_id }],
      queryFn: () => call('get_file', { id: item.file_id }),
    })),
  });
  return fileQueries.flatMap((query) => (query.data ? [query.data] : []));
}
