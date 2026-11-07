import { beforeEach, describe, expect, it } from 'vitest';
import { endTour, moveTour, placeCard, startTour, STEPS, useTour } from '../src/web/tour.ts';

beforeEach(() => useTour.setState({ seen: false, step: null, direction: 1 }));

describe('guided tour', () => {
  it('names the targets other screens add, by data-tour id', () => {
    const targets = STEPS.map((s) => s.target);
    expect(targets).toContain('vfolders');
    expect(targets).toContain('tag-refresh');
    expect(STEPS[0]!.target).toBeUndefined();
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length);
  });

  it('moves both ways, ends after the last step, and remembers it was seen', () => {
    startTour();
    moveTour(1);
    expect(useTour.getState()).toMatchObject({ step: 1, direction: 1 });
    moveTour(-1);
    expect(useTour.getState()).toMatchObject({ step: 0, direction: -1 });
    // Walking back past the first step, as skipping a missing target can, turns forward again.
    moveTour(-1);
    expect(useTour.getState()).toMatchObject({ step: 0, direction: 1 });
    useTour.setState({ step: STEPS.length - 1 });
    moveTour(1);
    expect(useTour.getState()).toMatchObject({ step: null, seen: true });
  });

  it('marks the tour seen when skipped, and does nothing once closed', () => {
    startTour();
    endTour();
    moveTour(1);
    expect(useTour.getState()).toMatchObject({ step: null, seen: true });
  });

  it('places the card beside its target, and keeps it in the window', () => {
    const viewport = { width: 1000, height: 800 };
    const card = { width: 300, height: 150 };
    expect(placeCard({ left: 10, top: 100, width: 50, height: 40 }, card, viewport)).toEqual({
      left: 72,
      top: 100,
    });
    // No room on the right: below, pulled back inside the window.
    expect(placeCard({ left: 800, top: 100, width: 190, height: 40 }, card, viewport)).toEqual({
      left: 688,
      top: 152,
    });
    // At the bottom right: above.
    expect(placeCard({ left: 800, top: 700, width: 190, height: 90 }, card, viewport)).toEqual({
      left: 688,
      top: 538,
    });
  });
});
