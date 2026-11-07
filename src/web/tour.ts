/**
 * The guided tour, in three parts: `STEPS`, its coach marks in the order of the rail; `useTour`,
 * which step shows and whether this viewer has seen the tour; and `placeCard`, where a card sits
 * beside its target. The coach mark itself is drawn by components/tour.tsx.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlainMessage } from './i18n/index.ts';
import type { Screen } from './screens.ts';

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

/** In order, down the rail. A step whose target is not on the page is skipped. */
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
    id: 'favorites',
    target: 'favorites',
    screen: 'browse',
    title: 'Favorites',
    body: 'Tags you star with ☆ are pinned here. Click one to show its files, or drop files on it to tag them.',
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
    id: 'vfolders',
    target: 'vfolders',
    screen: 'folders',
    title: 'Folders (virtual)',
    body: 'A virtual folder is a saved tag search. Matching files collect in it on their own, and nothing is moved. A suggestion here makes one in a click.',
  },
  {
    id: 'tags',
    target: 'screen-tags',
    screen: 'tags',
    title: 'Tags',
    body: 'Every tag in your folders, as a tree. Rename, merge, move and colour them here. Organize, Review and Names are here too.',
  },
  {
    id: 'review',
    target: 'tags-section-review',
    screen: 'tags',
    title: 'Review (section)',
    body: 'Answers the model was unsure of wait here. Nothing is written until you accept it.',
  },
  {
    id: 'tag-actions',
    target: 'tag-detail',
    screen: 'tags',
    title: "A tag's actions",
    body: 'Select a tag to work on it here: star it for Favorites, rename or move it, or Refresh it to find files it may have missed. Every change is a plan you apply.',
  },
  {
    id: 'dashboard',
    target: 'screen-dashboard',
    screen: 'dashboard',
    title: 'Dashboard',
    body: 'Model usage and its estimated cost, the state of your folders, and the history. Every change to tags is a plan listed here, and any plan can be undone.',
  },
  {
    id: 'questions',
    target: 'screen-facets',
    screen: 'facets',
    title: 'Questions (screen)',
    body: 'The questions asked about each file, and the labels each answer can pick. Turn packs on or off and edit them here.',
  },
  {
    id: 'settings',
    target: 'screen-settings',
    title: 'Settings',
    body: 'Choose models, add keys and folders. Start this tour again from Settings or the command palette.',
  },
];

type TourState = {
  /** Persisted: this viewer has finished or skipped the tour. */
  seen: boolean;
  /** The index in `STEPS` of the step on screen, or null when the tour is closed. */
  step: number | null;
  /** Which way the last move went, so a missing target is skipped in the same direction. */
  direction: 1 | -1;
};

/** Kept in this browser like the window's other preferences, so each viewer sees the tour once. */
export const useTour = create<TourState>()(
  persist((): TourState => ({ seen: false, step: null, direction: 1 }), {
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
  const { step: currentIndex } = useTour.getState();
  if (currentIndex === null) return;
  const nextIndex = currentIndex + direction;
  if (nextIndex >= STEPS.length) endTour();
  else if (nextIndex < 0) useTour.setState({ step: 0, direction: 1 });
  else useTour.setState({ step: nextIndex, direction });
}

/** A rectangle on screen, in CSS pixels from the top left of the window. */
type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
/** Where the card's top left corner goes. */
type Point = { left: number; top: number };

/** The card's corner on the first side of `target` with room for it: right, below, above, else left. */
function besideTarget(target: Box, card: Size, viewport: Size, gap: number): Point {
  const targetRight = target.left + target.width;
  const targetBottom = target.top + target.height;
  const fitsRight = viewport.width - targetRight - gap >= card.width;
  const fitsBelow = viewport.height - targetBottom - gap >= card.height;
  const fitsAbove = target.top - gap >= card.height;
  if (fitsRight) return { left: targetRight + gap, top: target.top };
  if (fitsBelow) return { left: target.left, top: targetBottom + gap };
  if (fitsAbove) return { left: target.left, top: target.top - gap - card.height };
  return { left: target.left - gap - card.width, top: target.top };
}

/** Where a card of `card` size goes beside `target`: right, below, above or left, kept in view. */
export function placeCard(target: Box, card: Size, viewport: Size, gap = 12): Point {
  const keepInView = (value: number, max: number) => Math.max(gap, Math.min(value, max - gap));
  const { left, top } = besideTarget(target, card, viewport, gap);
  return {
    left: keepInView(left, viewport.width - card.width),
    top: keepInView(top, viewport.height - card.height),
  };
}
