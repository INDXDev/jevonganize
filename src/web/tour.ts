/** The guided tour: its steps, whether this viewer has seen it, and where coach marks go. */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlainMessage } from './i18n/index.ts';
import type { Screen } from './view-query.ts';

/** One coach mark. `target` names an element by its `data-tour` attribute. */
export type TourStep = {
  id: string;
  /** Absent for a card in the middle of the window, with nothing highlighted. */
  target?: string;
  /** The screen the target lives on. The tour goes there first. */
  screen?: Screen;
  title: PlainMessage;
  body: PlainMessage;
};

/** In order. A step whose target is not on the page is skipped, so later features can add theirs. */
export const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Jevonganize',
    body: 'A one-minute tour of the main screens. Jevonganize only adds tags. It never moves, renames or deletes a file.',
  },
  {
    id: 'library',
    target: 'library',
    screen: 'browse',
    title: 'Your folders',
    body: 'Folders you added are listed here. Add more in Settings, under Folders.',
  },
  {
    id: 'scan',
    target: 'scan',
    screen: 'browse',
    title: 'Scan',
    body: 'Scanning reads the folder into the index. It runs on this machine and costs nothing.',
  },
  {
    id: 'organize',
    target: 'organize',
    screen: 'browse',
    title: 'Organize',
    body: 'The decision model answers a set of questions about each file and picks tags from fixed labels. You see what is sent and the cost before it starts.',
  },
  {
    id: 'review',
    target: 'screen-review',
    title: 'Review',
    body: 'Answers the model was unsure of wait here. Nothing is written until you accept it.',
  },
  {
    id: 'tags',
    target: 'screen-tags',
    title: 'Tags',
    body: 'Every tag in your folders. Rename, merge and colour them here.',
  },
  {
    id: 'vfolders',
    target: 'vfolders',
    screen: 'browse',
    title: 'Virtual folders',
    body: 'A virtual folder is a saved tag search. Matching files collect in it on their own, and nothing is moved.',
  },
  {
    id: 'tag-refresh',
    target: 'tag-refresh',
    screen: 'tags',
    title: 'Refresh a tag',
    body: 'Refresh looks for files a tag may have missed. The decision model checks each one, and its finds go to Review.',
  },
  {
    id: 'history',
    target: 'screen-activity',
    title: 'History and undo',
    body: 'Every change to tags is a plan, listed here. Any plan can be undone.',
  },
  {
    id: 'settings',
    target: 'screen-settings',
    title: 'Settings',
    body: 'Choose models, add keys and folders. Start this tour again from Settings or the command palette.',
  },
];

type Tour = {
  /** Persisted: this viewer has finished or skipped the tour. */
  seen: boolean;
  /** The step on screen, or null when the tour is closed. */
  step: number | null;
  /** Which way the last move went, so a missing target is skipped in the same direction. */
  direction: 1 | -1;
};

/** Kept in this browser like the window's other preferences, so each viewer sees the tour once. */
export const useTour = create<Tour>()(
  persist((): Tour => ({ seen: false, step: null, direction: 1 }), {
    name: 'jev-tour',
    partialize: ({ seen }) => ({ seen }),
  }),
);

/** Opens the tour at its first card. */
export const startTour = () => useTour.setState({ step: 0, direction: 1 });

/** Closes the tour, finished or skipped, and remembers that it was seen. */
export const endTour = () => useTour.setState({ step: null, seen: true });

/** Moves one step. Past the last step the tour ends; before the first it turns forward again. */
export function moveTour(direction: 1 | -1): void {
  const { step } = useTour.getState();
  if (step === null) return;
  const next = step + direction;
  if (next >= STEPS.length) endTour();
  else if (next < 0) useTour.setState({ step: 0, direction: 1 });
  else useTour.setState({ step: next, direction });
}

type Box = { left: number; top: number; width: number; height: number };

/** Where a card of `card` size goes beside `target`: right, below, above or left, kept in view. */
export function placeCard(
  target: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
): { left: number; top: number } {
  const clamp = (value: number, max: number) => Math.max(gap, Math.min(value, max - gap));
  const room = {
    right: viewport.width - (target.left + target.width) - gap,
    below: viewport.height - (target.top + target.height) - gap,
    above: target.top - gap,
    left: target.left - gap,
  };
  let left: number;
  let top: number;
  if (room.right >= card.width) {
    left = target.left + target.width + gap;
    top = target.top;
  } else if (room.below >= card.height) {
    left = target.left;
    top = target.top + target.height + gap;
  } else if (room.above >= card.height) {
    left = target.left;
    top = target.top - gap - card.height;
  } else {
    left = target.left - gap - card.width;
    top = target.top;
  }
  return {
    left: clamp(left, viewport.width - card.width),
    top: clamp(top, viewport.height - card.height),
  };
}
