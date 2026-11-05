/** Window state: the tab store, plus what belongs to the window and not to a view. */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  parseView,
  patchQuery,
  titleOf,
  type Patch,
  type Screen,
  type View,
} from './view-query.ts';

export type Tab = { id: string; title: string; query: string };

type Tabs = {
  tabs: Tab[];
  activeId: string;
  open: (query?: string) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  /** Replaces the active tab's query. */
  navigate: (query: string) => void;
};

const tab = (query: string): Tab => ({ id: crypto.randomUUID(), title: titleOf(query), query });
const first = tab(location.search.slice(1));

export const useTabs = create<Tabs>()(
  persist(
    (set, get) => ({
      tabs: [first],
      activeId: first.id,
      open: (query = '') => {
        const next = tab(query);
        set({ tabs: [...get().tabs, next], activeId: next.id });
      },
      close: (id) => {
        const { tabs, activeId } = get();
        const at = tabs.findIndex((t) => t.id === id);
        const rest = tabs.filter((t) => t.id !== id);
        if (!rest.length) rest.push(tab(''));
        const active = activeId === id ? rest[Math.min(at, rest.length - 1)]!.id : activeId;
        set({ tabs: rest, activeId: active });
      },
      activate: (activeId) => set({ activeId }),
      navigate: (query) =>
        set(({ tabs, activeId }) => ({
          tabs: tabs.map((t) => (t.id === activeId ? { ...t, query, title: titleOf(query) } : t)),
        })),
    }),
    {
      name: 'jev-tabs',
      partialize: ({ tabs, activeId }) => ({ tabs, activeId }),
      // A link wins over the stored tabs, so an address restores its view.
      merge: (stored, current) => {
        const merged = { ...current, ...(stored as Partial<Tabs>) };
        const link = location.search.slice(1);
        const known = merged.tabs.find((t) => t.query === link);
        if (!link) return merged;
        if (known) return { ...merged, activeId: known.id };
        const next = tab(link);
        return { ...merged, tabs: [...merged.tabs, next], activeId: next.id };
      },
    },
  ),
);

export const activeTab = (s: Tabs = useTabs.getState()) =>
  s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0]!;

export const setView = (patch: Patch) =>
  useTabs.getState().navigate(patchQuery(activeTab().query, patch));

/** Goes to a screen, keeping the rest of the query so the browser filter survives a round trip. */
export const goTo = (screen: Screen) => setView({ screen, section: null, facet: null });

/** The active tab's view. */
export const useView = (): View => parseView(useTabs((s) => activeTab(s).query));

/** Files picked in the list: a set of ids, or everything the query matches. */
export type Selection = { ids: Set<number>; all: boolean };

type Overlay = 'palette' | 'shortcuts' | 'tag' | 'preview' | null;

type Window = {
  sidebar: boolean;
  inspector: boolean;
  chat: boolean;
  density: 'comfortable' | 'compact';
  scale: number;
  skipped: boolean;
  overlay: Overlay;
  selection: Selection;
  /** What the file list currently counts. */
  total: number | null;
  /** The plan a bulk tag action just proposed, shown in the inspector. */
  planId: string | null;
  message: { text: string; error: boolean } | null;
  /** Named actions the mounted view offers. Commands dispatch to these. */
  actions: Record<string, () => void>;
  recent: string[];
};

export const useWindow = create<Window>()(
  persist(
    (): Window => ({
      sidebar: true,
      inspector: true,
      chat: false,
      density: 'comfortable',
      scale: 1,
      skipped: false,
      overlay: null,
      selection: { ids: new Set(), all: false },
      total: null,
      planId: null,
      message: null,
      actions: {},
      recent: [],
    }),
    {
      name: 'jev-window',
      partialize: ({ sidebar, inspector, density, scale, skipped, recent }) => ({
        sidebar,
        inspector,
        density,
        scale,
        skipped,
        recent,
      }),
    },
  ),
);

let clearing: ReturnType<typeof setTimeout>;

/** Shows a line in the status bar, which is also the polite live region. */
export function notify(text: string, error = false) {
  useWindow.setState({ message: { text, error } });
  clearTimeout(clearing);
  clearing = setTimeout(() => useWindow.setState({ message: null }), error ? 8000 : 4000);
}

export const toggle = (key: 'sidebar' | 'inspector' | 'chat') =>
  useWindow.setState((s) => ({ [key]: !s[key] }));

export const clearSelection = () =>
  useWindow.setState({ selection: { ids: new Set(), all: false } });

/** Offers actions to the command table while the calling component is mounted. */
export function useActions(actions: Record<string, () => void>) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const names = Object.keys(actions).join();
  useEffect(() => {
    const keys = names.split(',');
    const bound = Object.fromEntries(keys.map((k) => [k, () => latest.current[k]?.()]));
    useWindow.setState((s) => ({ actions: { ...s.actions, ...bound } }));
    return () => {
      useWindow.setState((s) => ({
        actions: Object.fromEntries(Object.entries(s.actions).filter(([k]) => !keys.includes(k))),
      }));
    };
  }, [names]);
}
