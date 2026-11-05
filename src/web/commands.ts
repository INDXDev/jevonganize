/** The one command array: bindings, palette rows and shortcut hints all come from it. */
import { useHotkeys } from 'react-hotkeys-hook';
import { act, call } from './api.ts';
import { isDesktop } from './lib.ts';
import { activeTab, goTo, notify, setView, toggle, useTabs, useWindow } from './tabs.ts';
import { parseView, type Screen } from './view-query.ts';

export type Command = {
  id: string;
  title: string;
  /** Comma-separated. Single letters are ignored while focus is in an input. */
  keys?: string;
  run: () => void;
  when?: () => boolean;
  /** Heading in the shortcut sheet. */
  group: string;
};

// Browsers keep Mod+T, Mod+W and Mod+1..9 for themselves. The desktop app leaves them free.
const tabMod = isDesktop ? 'mod' : 'alt';

const has = (action: string) => () => action in useWindow.getState().actions;
const dispatch = (action: string) => () => useWindow.getState().actions[action]?.();

/** A command that a mounted view provides. */
const action = (group: string, id: string, title: string, keys?: string): Command => ({
  id,
  title,
  keys,
  group,
  run: dispatch(id),
  when: has(id),
});

const go = (screen: Screen, title: string, key: string): Command => ({
  id: `go-${screen}`,
  title: `Go to ${title}`,
  keys: `g>${key}`,
  group: 'Go',
  run: () => goTo(screen),
});

async function undoLast() {
  const [plan] = (await call('list_plans', { status: 'applied' })).toSorted(
    (a, b) => b.created_at - a.created_at,
  );
  if (!plan) return notify('No applied plan to undo');
  await act('undo_plan', { id: plan.id });
  notify(`Undoing ${plan.title}`);
}

const organizeView = () => {
  const { folder } = parseView(activeTab().query);
  void act('organize', { query: { folder } });
  notify('Organizing this folder');
};

export const commands: Command[] = [
  {
    id: 'palette',
    title: 'Command palette',
    keys: 'mod+k,mod+shift+p',
    group: 'Global',
    run: () => useWindow.setState({ overlay: 'palette' }),
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    keys: '?',
    group: 'Global',
    run: () => useWindow.setState({ overlay: 'shortcuts' }),
  },
  {
    id: 'new-tab',
    title: 'New tab',
    keys: `${tabMod}+t`,
    group: 'Global',
    run: () => useTabs.getState().open(),
  },
  {
    id: 'close-tab',
    title: 'Close tab',
    keys: `${tabMod}+w`,
    group: 'Global',
    run: () => useTabs.getState().close(useTabs.getState().activeId),
  },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `tab-${i + 1}`,
    title: `Go to tab ${i + 1}`,
    keys: `${tabMod}+${i + 1}`,
    group: 'Global',
    run: () => {
      const { tabs, activate } = useTabs.getState();
      if (tabs[i]) activate(tabs[i].id);
    },
    when: () => !!useTabs.getState().tabs[i],
  })),
  {
    id: 'sidebar',
    title: 'Toggle sidebar',
    keys: 'mod+b',
    group: 'Global',
    run: () => toggle('sidebar'),
  },
  {
    id: 'inspector',
    title: 'Toggle inspector',
    keys: 'mod+period',
    group: 'Global',
    run: () => toggle('inspector'),
  },
  { id: 'chat', title: 'Toggle chat', keys: 'mod+i', group: 'Global', run: () => toggle('chat') },
  {
    id: 'undo',
    title: 'Undo the last applied plan',
    keys: 'mod+z',
    group: 'Global',
    run: () => void undoLast(),
  },
  action('Global', 'save', 'Save the open form', 'mod+s'),
  action('Global', 'clear', 'Clear the selection or filter', 'escape'),
  go('browse', 'browser', 'b'),
  go('review', 'review', 'r'),
  go('facets', 'facets', 'f'),
  go('settings', 'settings', 's'),
  go('activity', 'activity', 'a'),
  action('File list', 'down', 'Move down', 'j,down'),
  action('File list', 'up', 'Move up', 'k,up'),
  action('File list', 'left', 'Move left', 'h,left'),
  action('File list', 'right', 'Move right', 'l,right'),
  action('File list', 'preview', 'Quick preview', 'space'),
  action('File list', 'open', 'Open in the inspector', 'enter'),
  action('File list', 'reveal', 'Reveal in the file manager', 'mod+enter'),
  action('File list', 'select', 'Toggle selection', 'x'),
  action('File list', 'selectAll', 'Select all in the query', 'mod+a'),
  action('File list', 'tag', 'Tag the selection', 't'),
  action('File list', 'filter', 'Focus the filter', '/'),
  action('File list', 'switchView', 'Switch grid and list', 'v'),
  action('Review', 'nextGroup', 'Next group', ']'),
  action('Review', 'prevGroup', 'Previous group', '['),
  action('Review', 'accept', 'Accept', 'a'),
  action('Review', 'reject', 'Reject', 'r'),
  action('Review', 'skip', 'Skip', 's'),
  action('Review', 'acceptAll', 'Accept the whole group', 'shift+a'),
  action('Review', 'rejectAll', 'Reject the whole group', 'shift+r'),
  {
    id: 'organize',
    title: 'Organize this folder',
    group: 'Files',
    run: organizeView,
  },
  {
    id: 'scan',
    title: 'Scan this folder',
    group: 'Files',
    run: () => {
      const { folder } = parseView(activeTab().query);
      void act('scan', { path: folder });
    },
  },
  {
    id: 'grid',
    title: 'Show as grid',
    group: 'Files',
    run: () => setView({ view: 'grid' }),
  },
  {
    id: 'list',
    title: 'Show as list',
    group: 'Files',
    run: () => setView({ view: 'list' }),
  },
];

const keyed = commands.flatMap((c) =>
  (c.keys ?? '')
    .split(',')
    .filter(Boolean)
    .map((k) => [k, c] as const),
);
// These are characters, not key positions, so they follow the layout. `?` and `[` move on JIS.
const isChar = (key: string) => /^[?/[\]]$/.test(key);

// Modified keys still work in a field, except those the field itself needs.
const worksInInputs = (key: string) => /^(mod|alt)\+/.test(key) && !/^mod\+(z|a|enter)$/.test(key);

const CHORD = 'g';
const chordKeys = keyed.flatMap(([k]) => (k.startsWith(`${CHORD}>`) ? [k.slice(2)] : []));
let chordAt = 0;

function dispatchKey(pressed: string, e: KeyboardEvent) {
  // Radix closes on this same Escape, so an open dialog means the key is already spent.
  if (pressed === 'escape' && document.querySelector('[role="dialog"]')) return;
  const { overlay } = useWindow.getState();
  if (overlay && pressed !== 'mod+k' && pressed !== 'mod+shift+p') return;

  const chord = Date.now() - chordAt < 1000;
  chordAt = 0;
  if (pressed === CHORD) {
    chordAt = Date.now();
    return;
  }
  const key = chord && chordKeys.includes(pressed) ? `${CHORD}>${pressed}` : pressed;
  const command = keyed.find(([k, c]) => k === key && (c.when?.() ?? true))?.[1];
  if (!command) return;
  // Keep Enter, Space and arrows for the control that has focus, unless that is the file list.
  const target = document.activeElement as HTMLElement | null;
  const inList = !target || target === document.body || !!target.closest('[data-list]');
  if (/^(mod\+)?(enter|space|up|down|left|right)$/.test(key) && !inList) return;
  e.preventDefault();
  command.run();
}

// shortcut: the library's `g>b` sequences share one buffer per hook call, so `g` chords are done above.
const plainKeys = keyed.map(([k]) => k).filter((k) => !k.includes('>'));

/** Binds every key in the table. Call once, in the shell. */
export function useBindings() {
  const bound = [...new Set([...plainKeys, CHORD, ...chordKeys])];
  useHotkeys(
    bound.filter((k) => !isChar(k)),
    (e, hotkey) => dispatchKey(hotkey.hotkey, e),
  );
  // `?` needs Shift on most layouts, so modifiers are ignored here and Mod is refused by hand.
  useHotkeys(
    bound.filter(isChar),
    (e, hotkey) => {
      if (!e.metaKey && !e.ctrlKey) dispatchKey(hotkey.hotkey, e);
    },
    { useKey: true, ignoreModifiers: true },
  );
  useHotkeys(bound.filter(worksInInputs), (e, hotkey) => dispatchKey(hotkey.hotkey, e), {
    enableOnFormTags: true,
    ignoreEventWhen: (e) => !(e.target as Element).matches('input, textarea, select'),
  });
}
