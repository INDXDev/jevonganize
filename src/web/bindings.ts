/** Binds every key of the command array, including the `g` chords that go to a screen. */
import { useHotkeys } from 'react-hotkeys-hook';
import { commands, type Command } from './commands.ts';
import { useWindow } from './tabs.ts';

// These are characters, not key positions, so they follow the layout. `?` and `[` move on JIS.
const LAYOUT_CHARACTER_KEY = /^[?/[\]]$/;
// Modified keys still work in a field, except those the field itself needs.
const MODIFIED_KEY = /^(mod|alt)\+/;
const FIELD_EDITING_KEY = /^mod\+(z|a|enter)$/;
/** Keys that move focus or press the focused control, which the file list also uses. */
const FOCUS_CONTROL_KEY = /^(mod\+)?(enter|space|up|down|left|right)$/;
const PALETTE_KEYS = ['mod+k', 'mod+shift+p'];

/** The key that starts a chord, such as `g` then `b` for Files. */
const CHORD_START = 'g';
const CHORD_PREFIX = `${CHORD_START}>`;
/** A chord's second key must follow its first within this time. */
const CHORD_WINDOW_MS = 1000;

const isLayoutCharacter = (key: string) => LAYOUT_CHARACTER_KEY.test(key);
const worksInFields = (key: string) => MODIFIED_KEY.test(key) && !FIELD_EDITING_KEY.test(key);
const isChordBinding = (binding: string) => binding.startsWith(CHORD_PREFIX);

/** One binding a command lists, such as `mod+k` or the chord `g>b`, paired with that command. */
type BoundCommand = { binding: string; command: Command };

/** The bindings a command lists, which are comma-separated in its table entry. */
const bindingsOf = (command: Command) => (command.keys ?? '').split(',').filter(Boolean);

const boundCommands: BoundCommand[] = commands.flatMap((command) =>
  bindingsOf(command).map((binding) => ({ binding, command })),
);
const allBindings = boundCommands.map(({ binding }) => binding);
/** The second keys of every chord. */
const chordSecondKeys = allBindings
  .filter(isChordBinding)
  .map((binding) => binding.slice(CHORD_PREFIX.length));

// shortcut: the library's `g>b` sequences share one buffer per hook call, so `g` chords are done here.
const singleKeys = allBindings.filter((binding) => !isChordBinding(binding));
/** Every key the hooks below listen for: single keys, plus both halves of the chords. */
const listenedKeys = [...new Set([...singleKeys, CHORD_START, ...chordSecondKeys])];
const physicalKeys = listenedKeys.filter((key) => !isLayoutCharacter(key));
const characterKeys = listenedKeys.filter(isLayoutCharacter);
const fieldSafeKeys = listenedKeys.filter(worksInFields);

/** When the chord key was last pressed, or 0 once a later key has used or dropped it. */
let chordStartedAt = 0;

/**
 * Records the press in the chord state and returns the binding it completes: null for a chord's
 * first key, the chord for its second key in time, else the key itself.
 */
function advanceChord(pressedKey: string): string | null {
  const chordIsOpen = Date.now() - chordStartedAt < CHORD_WINDOW_MS;
  chordStartedAt = 0;
  if (pressedKey === CHORD_START) {
    chordStartedAt = Date.now();
    return null;
  }
  const completesChord = chordIsOpen && chordSecondKeys.includes(pressedKey);
  return completesChord ? `${CHORD_PREFIX}${pressedKey}` : pressedKey;
}

/** Whether focus is on the file list, or on nothing, where list keys belong to the list. */
function focusIsOnList(): boolean {
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || focused === document.body) return true;
  return !!focused.closest('[data-list]');
}

/** Whether a dialog or overlay on screen has already taken this press, so no command should run. */
function isClaimedByOverlay(pressedKey: string): boolean {
  // Radix closes on this same Escape, so an open dialog means the key is already spent.
  const closesDialog = pressedKey === 'escape' && !!document.querySelector('[role="dialog"]');
  if (closesDialog) return true;
  const overlayIsOpen = !!useWindow.getState().overlay;
  return overlayIsOpen && !PALETTE_KEYS.includes(pressedKey);
}

/** The command bound to `binding` that is offered right now, if any. */
const offeredCommand = (binding: string) =>
  boundCommands.find((bound) => bound.binding === binding && (bound.command.when?.() ?? true))
    ?.command;

/** Runs the command a press is bound to, if one is offered now. */
function runBoundCommand(pressedKey: string, event: KeyboardEvent): void {
  if (isClaimedByOverlay(pressedKey)) return;
  const binding = advanceChord(pressedKey);
  if (binding === null) return;
  const command = offeredCommand(binding);
  if (!command) return;
  // Keep Enter, Space and arrows for the control that has focus, unless that is the file list.
  const belongsToFocusedControl = FOCUS_CONTROL_KEY.test(binding) && !focusIsOnList();
  if (belongsToFocusedControl) return;
  event.preventDefault();
  command.run();
}

/** The callback every hook below shares: the library names the pressed key in `hotkey`. */
const runHotkey = (event: KeyboardEvent, { hotkey }: { hotkey: string }) =>
  runBoundCommand(hotkey, event);

const isInField = (event: KeyboardEvent) =>
  (event.target as Element).matches('input, textarea, select');
const hasModKey = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;

/** Binds every key in the table. Call once, in the shell. */
export function useBindings(): void {
  useHotkeys(physicalKeys, runHotkey);
  // `?` needs Shift on most layouts, so modifiers are ignored here and Mod is refused by hand.
  useHotkeys(
    characterKeys,
    (event, hotkey) => {
      if (!hasModKey(event)) runHotkey(event, hotkey);
    },
    { useKey: true, ignoreModifiers: true },
  );
  useHotkeys(fieldSafeKeys, runHotkey, {
    enableOnFormTags: true,
    ignoreEventWhen: (event) => !isInField(event),
  });
}
