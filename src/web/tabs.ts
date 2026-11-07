/** Window state: the tab store, plus what belongs to the window and not to a view. */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Screen } from './screens.ts';
import { parseView, patchQuery, titleOf, type Patch, type View } from './view-query.ts';

/** One tab: its view lives entirely in `query`, and `title` is derived from it. */
export type Tab = { id: string; title: string; query: string };

type TabStore = {
  tabs: Tab[];
  activeId: string;
  /** Opens a tab on `query` and makes it the active one. */
  open: (query?: string) => void;
  /** Closes a tab, keeping at least one open. */
  close: (id: string) => void;
  activate: (id: string) => void;
  /** Replaces the active tab's query. */
  navigate: (query: string) => void;
};

/** A tab on `query`, rewritten to its current form so that an old link opens where its screen went. */
function tabOn(query: string, id: string = crypto.randomUUID()): Tab {
  const current = patchQuery(query, {});
  return { id, title: titleOf(current), query: current };
}
/** The same tab on another query, with the title that query gives. */
const withQuery = (tab: Tab, query: string): Tab => ({ ...tab, query, title: titleOf(query) });
/** A tab on the address the window was opened with, which is empty without a link. */
const linkedTab = () => tabOn(location.search.slice(1));
const firstTab = linkedTab();

/** The tabs left after closing `closedId`, and which of them is active then. */
function withoutTab(tabs: Tab[], activeId: string, closedId: string) {
  const closedIndex = tabs.findIndex((tab) => tab.id === closedId);
  const remaining = tabs.filter((tab) => tab.id !== closedId);
  // The window always keeps one tab, so closing the last opens a fresh one.
  if (!remaining.length) remaining.push(tabOn(''));
  // Closing the active tab activates the one that slid into its place.
  const neighbour = remaining[Math.min(closedIndex, remaining.length - 1)]!;
  return { tabs: remaining, activeId: activeId === closedId ? neighbour.id : activeId };
}

/** Restores the stored tabs, then lets a link win over them so an address restores its view. */
function restoreTabs(stored: unknown, current: TabStore): TabStore {
  const merged = { ...current, ...(stored as Partial<TabStore>) };
  const tabs = merged.tabs.map((tab) => tabOn(tab.query, tab.id));
  const linked = linkedTab();
  if (!linked.query) return { ...merged, tabs };
  const alreadyOpen = tabs.find((tab) => tab.query === linked.query);
  if (alreadyOpen) return { ...merged, tabs, activeId: alreadyOpen.id };
  return { ...merged, tabs: [...tabs, linked], activeId: linked.id };
}

/** The open tabs and which one is active, kept across reloads. */
export const useTabs = create<TabStore>()(
  persist(
    (set, get) => ({
      tabs: [firstTab],
      activeId: firstTab.id,
      open: (query = '') => {
        const next = tabOn(query);
        set({ tabs: [...get().tabs, next], activeId: next.id });
      },
      close: (id) => {
        const { tabs, activeId } = get();
        set(withoutTab(tabs, activeId, id));
      },
      activate: (activeId) => set({ activeId }),
      navigate: (query) =>
        set(({ tabs, activeId }) => ({
          tabs: tabs.map((tab) => (tab.id === activeId ? withQuery(tab, query) : tab)),
        })),
    }),
    {
      name: 'jev-tabs',
      partialize: ({ tabs, activeId }) => ({ tabs, activeId }),
      merge: restoreTabs,
    },
  ),
);

/** The active tab, or the first if the active id is stale. */
export const activeTab = (store: TabStore = useTabs.getState()) =>
  store.tabs.find((tab) => tab.id === store.activeId) ?? store.tabs[0]!;

/** Changes part of the active tab's view, keeping the rest of its query. */
export const setView = (patch: Patch) =>
  useTabs.getState().navigate(patchQuery(activeTab().query, patch));

/**
 * Goes to a screen, and to one of its sections if given, keeping the rest of the query so the
 * browser filter survives a round trip.
 */
export function goTo(screen: Screen, section?: string): void {
  // The open virtual folder belongs to Folders, so going to Files leaves it.
  const leaveFolder = screen === 'browse' ? { vfolder: null, vname: null } : {};
  setView({ screen, section: section ?? null, facet: null, ...leaveFolder });
}

/** The active tab's view. */
export const useView = (): View => parseView(useTabs((s) => activeTab(s).query));

/** Files picked in the list: a set of ids, or everything the query matches. */
export type Selection = { ids: Set<number>; all: boolean };

type Overlay = 'palette' | 'shortcuts' | 'tag' | 'untag' | 'preview' | null;

/** `system` follows the OS, and keeps following it while the app is open. */
export type Theme = 'system' | 'light' | 'dark';

const noSelection = (): Selection => ({ ids: new Set(), all: false });

type WindowState = {
  /** Whether each pane is open. */
  sidebar: boolean;
  inspector: boolean;
  chat: boolean;
  theme: Theme;
  density: 'comfortable' | 'compact';
  /** The UI zoom factor, 1 at the default size. */
  scale: number;
  /** Whether the person skipped onboarding, so it does not show again. */
  skipped: boolean;
  /** The one overlay open on top of the window, if any. */
  overlay: Overlay;
  selection: Selection;
  /** What the file list currently counts. */
  total: number | null;
  /** The plan a bulk tag action just proposed, shown in the inspector. */
  planId: string | null;
  message: { text: string; error: boolean } | null;
  /** Named actions the mounted view offers. Commands dispatch to these. */
  actions: Record<string, () => void>;
  /** Ids of the commands last run from the palette, newest first. */
  recent: string[];
};

/** What belongs to the window: panes, theme, overlays, selection and messages. */
export const useWindow = create<WindowState>()(
  persist(
    (): WindowState => ({
      sidebar: true,
      inspector: true,
      chat: false,
      theme: 'system',
      density: 'comfortable',
      scale: 1,
      skipped: false,
      overlay: null,
      selection: noSelection(),
      total: null,
      planId: null,
      message: null,
      actions: {},
      recent: [],
    }),
    {
      name: 'jev-window',
      partialize: ({ sidebar, inspector, theme, density, scale, skipped, recent }) => ({
        sidebar,
        inspector,
        theme,
        density,
        scale,
        skipped,
        recent,
      }),
    },
  ),
);

const paintTheme = ({ theme }: WindowState) => {
  document.documentElement.dataset.theme = theme;
};
// At import, so the first paint already has it.
paintTheme(useWindow.getState());
useWindow.subscribe(paintTheme);

let messageTimer: ReturnType<typeof setTimeout>;
const MESSAGE_MS = 4000;
// An error stays longer, as it is more likely to need a second read.
const ERROR_MESSAGE_MS = 8000;

/** Shows a line in the status bar, which is also the polite live region. */
export function notify(text: string, error = false) {
  useWindow.setState({ message: { text, error } });
  clearTimeout(messageTimer);
  const shownForMs = error ? ERROR_MESSAGE_MS : MESSAGE_MS;
  messageTimer = setTimeout(() => useWindow.setState({ message: null }), shownForMs);
}

/** Opens or closes one of the window's panes. */
export const toggle = (key: 'sidebar' | 'inspector' | 'chat') =>
  useWindow.setState((s) => ({ [key]: !s[key] }));

/** Selects nothing. */
export const clearSelection = () => useWindow.setState({ selection: noSelection() });

/** Offers actions to the command table while the calling component is mounted. */
export function useActions(actions: Record<string, () => void>) {
  // Handlers are read at call time, so a re-render does not register them again.
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const actionNamesKey = Object.keys(actions).join();
  useEffect(() => {
    const names = actionNamesKey.split(',');
    const dispatchers = Object.fromEntries(
      names.map((name) => [name, () => latest.current[name]?.()]),
    );
    useWindow.setState((s) => ({ actions: { ...s.actions, ...dispatchers } }));
    return () => {
      useWindow.setState((s) => {
        const kept = Object.entries(s.actions).filter(([name]) => !names.includes(name));
        return { actions: Object.fromEntries(kept) };
      });
    };
  }, [actionNamesKey]);
}
