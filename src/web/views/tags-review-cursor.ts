import { useState } from 'react';
import type { FileRow } from '../../types.ts';
import { useReset } from '../lib.ts';
import { setView, useView } from '../tabs.ts';
import type { ReviewGroup } from './tags-review-state.ts';

/** `value`, kept between `min` and `max`. */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Which group and item are open. The group lives in the URL, the item in this hook. */
export function useReviewCursor(groups: ReviewGroup[]) {
  const view = useView();
  const [itemIndex, setItemIndex] = useState(0);
  // An unknown or missing tag in the URL opens the first group.
  const groupInUrl = groups.findIndex((group) => group.key === view.tag[0]);
  const openGroupIndex = Math.max(0, groupInUrl);
  const openGroup = groups[openGroupIndex];
  const openItems = openGroup?.items ?? [];
  const lastItemIndex = openItems.length - 1;
  const openItem = openItems[Math.min(itemIndex, lastItemIndex)];

  useReset(openGroup?.key, () => setItemIndex(0));

  const nextItem = () => setItemIndex((index) => Math.min(lastItemIndex, index + 1));
  const prevItem = () => setItemIndex((index) => Math.max(0, index - 1));
  const openItemOfFile = (row: FileRow) =>
    setItemIndex(openItems.findIndex((entry) => entry.file_id === row.id));
  const stepGroup = (delta: number) => {
    const target = groups[clamp(openGroupIndex + delta, 0, groups.length - 1)];
    if (target) setView({ tag: [target.key] });
  };
  return {
    openGroupIndex,
    openGroup,
    openItems,
    openItem,
    nextItem,
    prevItem,
    openItemOfFile,
    stepGroup,
  };
}
