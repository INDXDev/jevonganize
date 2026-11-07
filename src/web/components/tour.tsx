import { t } from '../i18n/index.ts';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setView, useView } from '../tabs.ts';
import { endTour, moveTour, placeCard, STEPS, useTour } from '../tour.ts';
import { Button } from './ui/button.tsx';

/** How long a step waits for its target, which may appear after a screen change. */
const WAIT_MS = 1200;
const CARD_WIDTH = 320;

const findTarget = (id: string) =>
  document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`);

type Found = { index: number; element: HTMLElement | null; box: DOMRect | null };

/**
 * Finds the step's target, going to its screen first, and measures it while the step is shown.
 * A target that does not turn up in time is skipped, in the direction the tour was moving.
 */
function useTarget(index: number | null): Found | null {
  const { screen } = useView();
  const step = index === null ? undefined : STEPS[index];
  const [found, setFound] = useState<Found | null>(null);
  const away = !!step?.screen && step.screen !== screen;

  useEffect(() => {
    if (!step || index === null) return;
    if (away) return setView({ screen: step.screen, section: null });
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      if (!step.target) return setFound({ index, element: null, box: null });
      const element = findTarget(step.target);
      if (element) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return setFound({ index, element, box: element.getBoundingClientRect() });
      }
      if (Date.now() - started > WAIT_MS) return moveTour(useTour.getState().direction);
      timer = setTimeout(look, 100);
    };
    timer = setTimeout(look, 0);
    return () => clearTimeout(timer);
  }, [step, index, away]);

  // Panes resize and lists load under a step, so the box is measured again, often and cheaply.
  const element = found?.index === index ? found.element : null;
  useEffect(() => {
    if (!element || index === null) return undefined;
    const measure = () =>
      setFound((now) =>
        now && now.element === element
          ? { ...now, box: element.isConnected ? element.getBoundingClientRect() : null }
          : now,
      );
    const timer = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [element, index]);

  return found && found.index === index && !away ? found : null;
}

/** Escape closes, and the arrow keys move, while focus is in the card. */
function useCardKeys(card: HTMLElement | null, index: number | null) {
  useEffect(() => {
    if (!card || index === null) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      else if (e.key === 'ArrowRight') moveTour(1);
      else if (e.key === 'ArrowLeft' && index > 0) moveTour(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    card.addEventListener('keydown', onKey);
    return () => card.removeEventListener('keydown', onKey);
  }, [card, index]);
}

/** Puts focus back where it was when the tour opened, once it closes. */
function useReturnFocus(open: boolean) {
  const returnTo = useRef<Element | null>(null);
  useEffect(() => {
    if (open) returnTo.current = document.activeElement;
    else if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected)
      returnTo.current.focus();
  }, [open]);
}

/** The coach mark over `[data-tour]` elements. Not modal: the app stays usable under it. */
export function Tour() {
  const index = useTour((s) => s.step);
  const found = useTarget(index);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useCardKeys(card, index);
  useReturnFocus(index !== null);

  const shown = found?.index ?? null;
  useLayoutEffect(() => {
    if (shown !== null) primary.current?.focus();
  }, [shown]);

  if (index === null || !found) return null;
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const width = Math.min(CARD_WIDTH, viewport.width - 24);
  const height = card?.offsetHeight ?? 180;
  const { box } = found;
  const position = box
    ? placeCard(box, { width, height }, viewport)
    : { left: (viewport.width - width) / 2, top: viewport.height / 4 };

  return (
    <>
      {box && (
        <div
          aria-hidden
          data-testid="tour-highlight"
          className="pointer-events-none fixed z-40 rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background transition-all duration-(--dur)"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}
      <dialog
        open
        ref={setCard}
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="overlay-in fixed z-50 m-0 rounded-lg border border-strong bg-popover p-3 text-foreground shadow-overlay"
        style={{ ...position, width }}
      >
        <div className="flex items-start gap-2">
          <h2 id="tour-title" className="min-w-0 flex-1 text-md font-medium">
            {t(step.title)}
          </h2>
          <Button
            variant="ghost"
            icon
            className="-mt-1 -mr-1 size-6"
            aria-label={t('Close the tour')}
            onClick={endTour}
          >
            <X />
          </Button>
        </div>
        <p id="tour-body" className="mt-1 text-sm text-muted-foreground">
          {t(step.body)}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-2xs text-subtle" aria-live="polite">
            {t('Step {step} of {total}', { step: index + 1, total: STEPS.length })}
          </span>
          <span className="flex-1" />
          {index === 0 ? (
            <Button variant="ghost" onClick={endTour}>
              {t('Not now')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={endTour}>
                {t('Skip tour')}
              </Button>
              <Button onClick={() => moveTour(-1)}>{t('Previous')}</Button>
            </>
          )}
          <Button ref={primary} variant="primary" onClick={() => moveTour(1)}>
            {index === 0 ? t('Show me around') : last ? t('Done') : t('Next')}
          </Button>
        </div>
      </dialog>
    </>
  );
}
