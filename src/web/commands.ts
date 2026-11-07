/** The one command array: bindings, palette rows and shortcut hints all come from it. */
import { t } from './i18n/index.ts';
import type { shell } from './i18n/shell.ts';
import { useHotkeys } from 'react-hotkeys-hook';
import { act, call, pickTopics, saveView, scanFolder, viewOptions } from './api.ts';
import { isDesktop } from './lib.ts';
import {
  activeTab,
  goTo,
  notify,
  setView,
  toggle,
  useTabs,
  useWindow,
  type Theme,
} from './tabs.ts';
import { parseView, SCREENS } from './view-query.ts';

type PlainKey = {
  [K in keyof typeof shell]: K extends `${string}{${string}` ? never : K;
}[keyof typeof shell];

export type Command = {
  id: string;
  title: string;
  /** Comma-separated. Single letters are ignored while focus is in an input. */
  keys?: string;
  run: () => void;
  when?: () => boolean;
  /** Heading in the shortcut sheet. */
  group: PlainKey;
};

// Browsers keep Mod+T, Mod+W and Mod+1..9 for themselves. The desktop app leaves them free.
const tabMod = isDesktop ? 'mod' : 'alt';

const has = (action: string) => () => action in useWindow.getState().actions;
const dispatch = (action: string) => () => useWindow.getState().actions[action]?.();

/** A command that a mounted view provides. */
const action = (group: PlainKey, id: string, title: PlainKey, keys?: string): Command => ({
  id,
  get title() {
    return t(title);
  },
  keys,
  group,
  run: dispatch(id),
  when: has(id),
});

const theme = (id: Theme, title: PlainKey): Command => ({
  id: `theme-${id}`,
  get title() {
    return t('Theme: {theme}', { theme: t(title) });
  },
  group: 'Appearance',
  run: () => useWindow.setState({ theme: id }),
});

const THUMBNAIL_STEP = 32;

/** Resizes tiles. Fixed columns set the size themselves, so this goes back to fitting by size. */
const resizeThumbnails = (delta: number) => () => {
  const size = viewOptions().thumbnail_size + delta;
  saveView({ thumbnail_size: Math.min(512, Math.max(64, size)), grid_columns: 0 });
};

async function undoLast() {
  const [plan] = (await call('list_plans', { status: 'applied' })).toSorted(
    (a, b) => b.created_at - a.created_at,
  );
  if (!plan) return notify(t('No applied plan to undo'));
  await act('undo_plan', { id: plan.id });
  notify(t('Undoing {title}', { title: plan.title }));
}

export const commands: Command[] = [
  {
    id: 'palette',
    get title() {
      return t('Command palette');
    },
    keys: 'mod+k,mod+shift+p',
    group: 'Global',
    run: () => useWindow.setState({ overlay: 'palette' }),
  },
  {
    id: 'shortcuts',
    get title() {
      return t('Keyboard shortcuts');
    },
    keys: '?',
    group: 'Global',
    run: () => useWindow.setState({ overlay: 'shortcuts' }),
  },
  {
    id: 'new-tab',
    get title() {
      return t('New tab');
    },
    keys: `${tabMod}+t`,
    group: 'Global',
    run: () => useTabs.getState().open(),
  },
  {
    id: 'close-tab',
    get title() {
      return t('Close tab');
    },
    keys: `${tabMod}+w`,
    group: 'Global',
    run: () => useTabs.getState().close(useTabs.getState().activeId),
  },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `tab-${i + 1}`,
    get title() {
      return t('Go to tab {number}', { number: i + 1 });
    },
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
    get title() {
      return t('Toggle sidebar');
    },
    keys: 'mod+b',
    group: 'Global',
    run: () => toggle('sidebar'),
  },
  {
    id: 'inspector',
    get title() {
      return t('Toggle inspector');
    },
    keys: 'mod+period',
    group: 'Global',
    run: () => toggle('inspector'),
  },
  {
    id: 'chat',
    get title() {
      return t('Toggle chat');
    },
    keys: 'mod+i',
    group: 'Global',
    run: () => toggle('chat'),
  },
  {
    id: 'undo',
    get title() {
      return t('Undo the last applied plan');
    },
    keys: 'mod+z',
    group: 'Global',
    run: () => void undoLast(),
  },
  action('Global', 'save', 'Save the open form', 'mod+s'),
  action('Global', 'clear', 'Clear the selection or filter', 'escape'),
  ...SCREENS.map(({ id, title, key }): Command => ({
    id: `go-${id}`,
    get title() {
      return t('Go to {screen}', { screen: t(title) });
    },
    keys: `g>${key}`,
    group: 'Go',
    run: () => goTo(id),
  })),
  theme('system', 'follow the system'),
  theme('light', 'light'),
  theme('dark', 'dark'),
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
  action('File list', 'untag', 'Remove a tag from the selection', 'shift+t'),
  action('File list', 'matchTags', 'Switch between any tag and all tags', 'm'),
  action('File list', 'filter', 'Focus the filter', '/'),
  action('File list', 'switchView', 'Switch grid and list', 'v'),
  action('File list', 'viewOptions', 'View options', 'mod+j'),
  action('Review', 'nextGroup', 'Next group', ']'),
  action('Review', 'prevGroup', 'Previous group', '['),
  action('Review', 'accept', 'Accept', 'a'),
  action('Review', 'reject', 'Reject', 'r'),
  action('Review', 'skip', 'Skip', 's'),
  action('Review', 'acceptAll', 'Accept the whole group', 'shift+a'),
  action('Review', 'rejectAll', 'Reject the whole group', 'shift+r'),
  {
    id: 'organize',
    get title() {
      return t('Organize this view');
    },
    group: 'Files',
    run: () => goTo('organize'),
  },
  {
    id: 'pickTopics',
    get title() {
      return t('Choose topics for this folder');
    },
    group: 'Files',
    run: () => void pickTopics(parseView(activeTab().query).folder),
  },
  {
    id: 'scan',
    get title() {
      return t('Scan this folder');
    },
    group: 'Files',
    run: () => void scanFolder(parseView(activeTab().query).folder),
  },
  {
    id: 'grid',
    get title() {
      return t('Show as grid');
    },
    group: 'Files',
    run: () => setView({ view: 'grid' }),
  },
  {
    id: 'list',
    get title() {
      return t('Show as list');
    },
    group: 'Files',
    run: () => setView({ view: 'list' }),
  },
  {
    id: 'dotfiles',
    get title() {
      return t('Show or hide dotfiles');
    },
    keys: 'mod+shift+period',
    group: 'Files',
    run: () => saveView({ show_dotfiles: !viewOptions().show_dotfiles }),
  },
  {
    id: 'larger',
    get title() {
      return t('Larger thumbnails');
    },
    group: 'Files',
    run: resizeThumbnails(THUMBNAIL_STEP),
  },
  {
    id: 'smaller',
    get title() {
      return t('Smaller thumbnails');
    },
    group: 'Files',
    run: resizeThumbnails(-THUMBNAIL_STEP),
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
