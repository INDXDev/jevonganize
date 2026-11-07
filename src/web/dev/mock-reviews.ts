/** The mock's review queue: answers below the apply level, and restore items. */
import type { ReviewItem } from '../../types.ts';
import type { ToolMap } from '../../tool-map.ts';
import { emit } from './mock-events.ts';
import { files } from './mock-files.ts';
import { propose } from './mock-plans.ts';

/** Each group of suggestions: its tag, why it waits, and how many files it holds. */
const SUGGESTION_GROUPS: { tag: string; reason: string; size: number }[] = [
  { tag: 'doc-type:invoice', reason: 'Below the apply level', size: 14 },
  { tag: 'topic:finance', reason: 'Below the apply level', size: 9 },
  { tag: 'invoice-state:unpaid', reason: 'Estimated by a chat model', size: 7 },
  { tag: 'flag:sensitive', reason: 'Two facets disagree', size: 5 },
  { tag: 'topic:research', reason: 'New value for an open facet', size: 3 },
];

function suggestions(): ReviewItem[] {
  const items = SUGGESTION_GROUPS.flatMap(({ tag, reason, size }, group) =>
    Array.from({ length: size }, (_, i): ReviewItem => {
      // Spreads each group over the library by fixed strides, so every load shows the same files.
      const fileId = 1 + ((group * 137 + i * 31) % files.length);
      // The fifth item of each group comes from a model with no probabilities.
      const confidence = i === 4 ? null : 0.84 - i * 0.015 - group * 0.02;
      return { id: group * 100 + i + 1, file_id: fileId, kind: 'suggest', tag, confidence, reason };
    }),
  );
  return items.toSorted(
    (a, b) => a.tag.localeCompare(b.tag) || (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

const restores = [1, 2, 3].map((n): ReviewItem => ({
  id: 900 + n,
  file_id: 50 * n,
  kind: 'restore',
  tag: 'project:atlas',
  confidence: null,
  reason: 'Restore',
}));

let reviews: ReviewItem[] = [...suggestions(), ...restores];

/** Every open review item. */
export const openReviews = () => reviews;

/** Stands in for `list_reviews`. */
export const listReviews = ({ tag, limit }: ToolMap['list_reviews'][0]) =>
  reviews.filter((item) => !tag || item.tag === tag).slice(0, limit);

/** Stands in for `resolve_reviews`: accepting proposes a plan of the accepted tags. */
export function resolveReviews({ ids, accept }: ToolMap['resolve_reviews'][0]) {
  const resolved = reviews.filter((item) => ids.includes(item.id));
  reviews = reviews.filter((item) => !ids.includes(item.id));
  emit({ type: 'reviews', count: reviews.length });
  if (!accept || !resolved.length) return null;
  return propose({
    file_ids: resolved.map((item) => item.file_id),
    add: [...new Set(resolved.map((item) => item.tag))],
    title: 'Accepted review items',
  });
}
