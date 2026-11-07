/** The screens of the rail, and the old screen ids that still lead to them. */

/** Every screen, in the order of the rail. `key` follows `g` to go there. */
export const SCREENS = [
  { id: 'browse', title: 'Files', key: 'b' },
  { id: 'folders', title: 'Folders (virtual)', key: 'v' },
  { id: 'tags', title: 'Tags', key: 't' },
  { id: 'dashboard', title: 'Dashboard', key: 'd' },
  { id: 'facets', title: 'Questions (screen)', key: 'f' },
  { id: 'settings', title: 'Settings', key: 's' },
] as const;

/** The id of one screen. */
export type Screen = (typeof SCREENS)[number]['id'];

/** Where a retired screen lives now, and the key and title it keeps for one release. */
type RetiredScreen = { screen: Screen; section: string; key: string; title: string };

/**
 * Screens that were merged into others, with where each one lives now. Old links and the old `g`
 * keys still reach them, for one release.
 */
export const RETIRED_SCREENS = {
  organize: { screen: 'tags', section: 'organize', key: 'o', title: 'Organize' },
  review: { screen: 'tags', section: 'review', key: 'r', title: 'Review' },
  names: { screen: 'tags', section: 'names', key: 'n', title: 'Names' },
  activity: { screen: 'dashboard', section: 'history', key: 'a', title: 'Activity' },
} as const satisfies Record<string, RetiredScreen>;

const isRetiredScreen = (id: string | null): id is keyof typeof RETIRED_SCREENS =>
  id !== null && Object.hasOwn(RETIRED_SCREENS, id);

/** Rewrites an old address to its current form, in place, so that both read the same. */
export function upgradeAddress(params: URLSearchParams): void {
  const screenId = params.get('screen');
  if (isRetiredScreen(screenId)) {
    const { screen, section } = RETIRED_SCREENS[screenId];
    params.set('screen', screen);
    params.set('section', section);
  }
  // A virtual folder used to open inside Files. It has a screen of its own now.
  const isOnFiles = !params.get('screen') || params.get('screen') === 'browse';
  if (isOnFiles && params.get('vfolder')) params.set('screen', 'folders');
}
