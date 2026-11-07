import { t } from '../i18n/index.ts';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { setView, useView } from '../tabs.ts';
import { endTour, moveTour, placeCard, STEPS, useTour } from '../tour.ts';
import { Button } from './ui/button.tsx';

/** How long a step waits for its target, which may appear after a screen change. */
const TARGET_WAIT_MS = 1200;
const TARGET_POLL_MS = 100;
/** Panes resize and lists load under a step, so its box is measured again this often. */
const REMEASURE_MS = 300;
const CARD_WIDTH = 320;
/** The card's height before it has rendered once and can be measured. */
const CARD_HEIGHT_GUESS = 180;

const findTarget = (id: string) =>
  document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`);

/** A step's target as found on the page. A step without a target has neither element nor box. */
type FoundTarget = { stepIndex: number; element: HTMLElement | null; box: DOMRect | null };

/**
 * Looks for the step's target until it turns up, going to its screen first. A target that does
 * not turn up in time is skipped, in the direction the tour was moving.
 */
function useTargetSearch(
  stepIndex: number | null,
  onScreen: boolean,
  setFound: (found: FoundTarget) => void,
) {
  const step = stepIndex === null ? undefined : STEPS[stepIndex];
  useEffect(() => {
    if (!step || stepIndex === null) return;
    if (!onScreen) return setView({ screen: step.screen, section: null });
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      if (!step.target) return setFound({ stepIndex, element: null, box: null });
      const element = findTarget(step.target);
      if (element) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return setFound({ stepIndex, element, box: element.getBoundingClientRect() });
      }
      if (Date.now() - startedAt > TARGET_WAIT_MS) return moveTour(useTour.getState().direction);
      timer = setTimeout(look, TARGET_POLL_MS);
    };
    timer = setTimeout(look, 0);
    return () => clearTimeout(timer);
  }, [step, stepIndex, onScreen, setFound]);
}

/** Measures the found element again, often and cheaply, while it stays the step's target. */
function useRemeasure(
  element: HTMLElement | null,
  setFound: (update: (found: FoundTarget | null) => FoundTarget | null) => void,
) {
  useEffect(() => {
    if (!element) return undefined;
    const measure = () =>
      setFound((found) => {
        if (!found || found.element !== element) return found;
        return { ...found, box: element.isConnected ? element.getBoundingClientRect() : null };
      });
    const timer = setInterval(measure, REMEASURE_MS);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [element, setFound]);
}

/** The step's target, found and measured while the step is shown, or null while it is looked for. */
function useTarget(stepIndex: number | null): FoundTarget | null {
  const { screen } = useView();
  const step = stepIndex === null ? undefined : STEPS[stepIndex];
  const [found, setFound] = useState<FoundTarget | null>(null);
  const onScreen = !step?.screen || step.screen === screen;
  const isCurrent = found?.stepIndex === stepIndex;

  useTargetSearch(stepIndex, onScreen, setFound);
  useRemeasure(isCurrent && stepIndex !== null ? found.element : null, setFound);

  return isCurrent && onScreen ? found : null;
}

/** Escape closes, and the arrow keys move, while focus is in the card. */
function useCardKeys(card: HTMLElement | null, stepIndex: number | null) {
  useEffect(() => {
    if (!card || stepIndex === null) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      else if (e.key === 'ArrowRight') moveTour(1);
      else if (e.key === 'ArrowLeft' && stepIndex > 0) moveTour(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    card.addEventListener('keydown', onKey);
    return () => card.removeEventListener('keydown', onKey);
  }, [card, stepIndex]);
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

/** Where the card goes: beside the target, or in the middle of the window when there is none. */
function cardPosition(box: DOMRect | null, card: HTMLElement | null) {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const width = Math.min(CARD_WIDTH, viewport.width - 24);
  const height = card?.offsetHeight ?? CARD_HEIGHT_GUESS;
  const centred = { left: (viewport.width - width) / 2, top: viewport.height / 4 };
  const position = box ? placeCard(box, { width, height }, viewport) : centred;
  return { ...position, width };
}

function TourButtons(props: { stepIndex: number; nextRef: Ref<HTMLButtonElement> }) {
  const { stepIndex, nextRef } = props;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const nextLabel = isFirst ? t('Show me around') : isLast ? t('Done') : t('Next');
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="font-mono text-2xs text-subtle" aria-live="polite">
        {t('Step {step} of {total}', { step: stepIndex + 1, total: STEPS.length })}
      </span>
      <span className="flex-1" />
      {isFirst ? (
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
      <Button ref={nextRef} variant="primary" onClick={() => moveTour(1)}>
        {nextLabel}
      </Button>
    </div>
  );
}

/** The coach mark over `[data-tour]` elements. Not modal: the app stays usable under it. */
export function Tour() {
  const stepIndex = useTour((s) => s.step);
  const found = useTarget(stepIndex);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  useCardKeys(card, stepIndex);
  useReturnFocus(stepIndex !== null);

  const shownStep = found?.stepIndex ?? null;
  useLayoutEffect(() => {
    if (shownStep !== null) nextButton.current?.focus();
  }, [shownStep]);

  if (stepIndex === null || !found) return null;
  const step = STEPS[stepIndex]!;
  const { box } = found;
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
        style={cardPosition(box, card)}
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
        <TourButtons stepIndex={stepIndex} nextRef={nextButton} />
      </dialog>
    </>
  );
}
