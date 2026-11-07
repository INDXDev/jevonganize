/** The one command array: bindings, palette rows and shortcut hints all come from it. Keys are bound in bindings.ts. */
import { t, type PlainMessage } from './i18n/index.ts';
import type { shell } from './i18n/shell.ts';
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
import { startTour } from './tour.ts';
import { RETIRED_SCREENS, SCREENS } from './screens.ts';
import { parseView } from './view-query.ts';

/** A catalog key with no placeholders, so it can be a title or heading as it is. */
type PlainKey = {
  [K in keyof typeof shell]: K extends `${string}{${string}` ? never : K;
}[keyof typeof shell];

/** One thing a person can do from a key, the palette or the shortcut sheet. */
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

/** A command as written in the table: its title is a catalog key, translated when read. */
type CommandSpec = Omit<Command, 'title'> & { title: PlainMessage };

/** Makes a command whose title is worked out each time it is read, so it follows the language. */
const titledCommand = (spec: Omit<Command, 'title'>, titleNow: () => string): Command => ({
  ...spec,
  get title() {
    return titleNow();
  },
});

/** Makes a command from its table entry, translating the title's catalog key when read. */
const command = ({ title, ...spec }: CommandSpec): Command => titledCommand(spec, () => t(title));

/** A command that a mounted view provides. It is offered only while that view is on screen. */
const action = (group: PlainKey, id: string, title: PlainMessage, keys?: string): Command =>
  command({
    id,
    group,
    title,
    keys,
    run: () => useWindow.getState().actions[id]?.(),
    when: () => id in useWindow.getState().actions,
  });

const themeCommand = (id: Theme, title: PlainMessage): Command =>
  titledCommand(
    { id: `theme-${id}`, group: 'Appearance', run: () => useWindow.setState({ theme: id }) },
    () => t('Theme: {theme}', { theme: t(title) }),
  );

const tabAt = (index: number) => useTabs.getState().tabs[index];

const tabCommand = (index: number): Command => {
  const number = index + 1;
  return titledCommand(
    {
      id: `tab-${number}`,
      keys: `${tabMod}+${number}`,
      group: 'Global',
      run: () => {
        const tab = tabAt(index);
        if (tab) useTabs.getState().activate(tab.id);
      },
      when: () => !!tabAt(index),
    },
    () => t('Go to tab {number}', { number }),
  );
};

/** A `g` chord that goes somewhere: a screen of the rail, or where a retired screen moved. */
const goCommand = (id: string, title: PlainMessage, key: string, go: () => void): Command =>
  titledCommand({ id: `go-${id}`, keys: `g>${key}`, group: 'Go', run: go }, () =>
    t('Go to {screen}', { screen: t(title) }),
  );

const THUMBNAIL_STEP = 32;
const MIN_THUMBNAIL = 64;
const MAX_THUMBNAIL = 512;

/** Resizes tiles. Fixed columns set the size themselves, so this goes back to fitting by size. */
const resizeThumbnails = (delta: number) => () => {
  const size = viewOptions().thumbnail_size + delta;
  const clamped = Math.min(MAX_THUMBNAIL, Math.max(MIN_THUMBNAIL, size));
  saveView({ thumbnail_size: clamped, grid_columns: 0 });
};

async function undoLastPlan() {
  const applied = await call('list_plans', { status: 'applied' });
  const [newest] = applied.toSorted((a, b) => b.created_at - a.created_at);
  if (!newest) return notify(t('No applied plan to undo'));
  await act('undo_plan', { id: newest.id });
  notify(t('Undoing {title}', { title: newest.title }));
}

const folderInView = () => parseView(activeTab().query).folder;

/** How many tabs have a Mod+number key. */
const NUMBERED_TABS = 9;

const globalCommands: Command[] = [
  command({
    id: 'palette',
    group: 'Global',
    title: 'Command palette',
    keys: 'mod+k,mod+shift+p',
    run: () => useWindow.setState({ overlay: 'palette' }),
  }),
  command({
    id: 'shortcuts',
    group: 'Global',
    title: 'Keyboard shortcuts',
    keys: '?',
    run: () => useWindow.setState({ overlay: 'shortcuts' }),
  }),
  command({
    id: 'new-tab',
    group: 'Global',
    title: 'New tab',
    keys: `${tabMod}+t`,
    run: () => useTabs.getState().open(),
  }),
  command({
    id: 'close-tab',
    group: 'Global',
    title: 'Close tab',
    keys: `${tabMod}+w`,
    run: () => useTabs.getState().close(useTabs.getState().activeId),
  }),
  ...Array.from({ length: NUMBERED_TABS }, (_, index) => tabCommand(index)),
  command({
    id: 'sidebar',
    group: 'Global',
    title: 'Toggle sidebar',
    keys: 'mod+b',
    run: () => toggle('sidebar'),
  }),
  command({
    id: 'inspector',
    group: 'Global',
    title: 'Toggle inspector',
    keys: 'mod+period',
    run: () => toggle('inspector'),
  }),
  command({
    id: 'chat',
    group: 'Global',
    title: 'Toggle chat',
    keys: 'mod+i',
    run: () => toggle('chat'),
  }),
  command({
    id: 'undo',
    group: 'Global',
    title: 'Undo the last applied plan',
    keys: 'mod+z',
    run: () => void undoLastPlan(),
  }),
  command({ id: 'tour', group: 'Global', title: 'Start the tour', run: startTour }),
  action('Global', 'save', 'Save the open form', 'mod+s'),
  action('Global', 'clear', 'Clear the selection or filter', 'escape'),
];

const goCommands: Command[] = [
  ...SCREENS.map(({ id, title, key }) => goCommand(id, title, key, () => goTo(id))),
  // Kept for one release, so the old keys still lead to where their screens went.
  ...Object.entries(RETIRED_SCREENS).map(([id, moved]) =>
    goCommand(id, moved.title, moved.key, () => goTo(moved.screen, moved.section)),
  ),
];

const themeCommands: Command[] = [
  themeCommand('system', 'follow the system'),
  themeCommand('light', 'light'),
  themeCommand('dark', 'dark'),
];

const fileListActions: Command[] = [
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
];

const reviewActions: Command[] = [
  action('Review', 'nextGroup', 'Next group', ']'),
  action('Review', 'prevGroup', 'Previous group', '['),
  action('Review', 'accept', 'Accept', 'a'),
  action('Review', 'reject', 'Reject', 'r'),
  action('Review', 'skip', 'Skip', 's'),
  action('Review', 'acceptAll', 'Accept the whole group', 'shift+a'),
  action('Review', 'rejectAll', 'Reject the whole group', 'shift+r'),
];

const filesCommands: Command[] = [
  command({
    id: 'organize',
    group: 'Files',
    title: 'Organize this view',
    run: () => goTo('tags', 'organize'),
  }),
  command({
    id: 'pickTopics',
    group: 'Files',
    title: 'Choose topics for this folder',
    run: () => void pickTopics(folderInView()),
  }),
  command({
    id: 'scan',
    group: 'Files',
    title: 'Scan this folder',
    run: () => void scanFolder(folderInView()),
  }),
  command({
    id: 'grid',
    group: 'Files',
    title: 'Show as grid',
    run: () => setView({ view: 'grid' }),
  }),
  command({
    id: 'list',
    group: 'Files',
    title: 'Show as list',
    run: () => setView({ view: 'list' }),
  }),
  command({
    id: 'dotfiles',
    group: 'Files',
    title: 'Show or hide dotfiles',
    keys: 'mod+shift+period',
    run: () => saveView({ show_dotfiles: !viewOptions().show_dotfiles }),
  }),
  command({
    id: 'larger',
    group: 'Files',
    title: 'Larger thumbnails',
    run: resizeThumbnails(THUMBNAIL_STEP),
  }),
  command({
    id: 'smaller',
    group: 'Files',
    title: 'Smaller thumbnails',
    run: resizeThumbnails(-THUMBNAIL_STEP),
  }),
];

/** Every command, in the order the palette and the shortcut sheet list them. */
export const commands: Command[] = [
  ...globalCommands,
  ...goCommands,
  ...themeCommands,
  ...fileListActions,
  ...reviewActions,
  ...filesCommands,
];
