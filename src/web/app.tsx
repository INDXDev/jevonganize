import {
  Command as Search,
  Keyboard,
  LoaderCircle,
  MessageSquare,
  Plus,
  Settings as Gear,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Group, Panel } from 'react-resizable-panels';
import { useEvents, useTool } from './api.ts';
import { commands, useBindings } from './commands.ts';
import { Divider } from './components/pane.tsx';
import { Palette } from './components/palette.tsx';
import { Button } from './components/ui/button.tsx';
import { Dialog } from './components/ui/dialog.tsx';
import { cn, formatCount, isDesktop, isMac, keyLabel } from './lib.ts';
import { activeTab, goTo, toggle, useTabs, useView, useWindow } from './tabs.ts';
import { Activity } from './views/activity.tsx';
import { Browse } from './views/browse.tsx';
import { Facets } from './views/facets.tsx';
import { Onboarding } from './views/onboarding.tsx';
import { Review } from './views/review.tsx';
import { Settings } from './views/settings.tsx';

const Chat = lazy(() => import('./views/chat.tsx'));

const screens = {
  browse: Browse,
  review: Review,
  facets: Facets,
  settings: Settings,
  activity: Activity,
};

function TitleBar() {
  const { tabs, activeId, activate, close, open } = useTabs();
  return (
    <header
      className={cn(
        'app-drag flex h-titlebar shrink-0 items-center gap-2 border-b border-strong bg-background pr-2 pl-3',
        // Room for the traffic lights: the desktop window uses `hiddenInset` on macOS.
        isDesktop && isMac && 'pl-20',
      )}
    >
      <img src="/icon.svg" alt="" className="size-5 shrink-0 rounded-sm" />
      <div role="tablist" aria-label="Tabs" className="flex min-w-0 items-center gap-0.5">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'group flex h-7 max-w-44 min-w-0 items-center rounded-md text-sm',
              tab.id === activeId
                ? 'bg-surface-3 text-foreground'
                : 'text-muted-foreground hover:bg-surface-2',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              onClick={() => activate(tab.id)}
              className="min-w-0 truncate pr-1 pl-2.5"
            >
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={() => close(tab.id)}
              className="mr-1 grid size-4 shrink-0 place-items-center rounded-sm text-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <Button variant="ghost" icon className="size-7" aria-label="New tab" onClick={() => open()}>
          <Plus />
        </Button>
      </div>
      <button
        type="button"
        onClick={() => useWindow.setState({ overlay: 'palette' })}
        className="ml-auto flex h-6 w-56 shrink-0 items-center gap-2 rounded-md border bg-surface-1 px-2 text-sm text-subtle hover:border-strong"
      >
        <Search className="size-3" /> Search or run
        <span className="kbd ml-auto">{keyLabel('mod+k')}</span>
      </button>
      <Button
        variant="ghost"
        icon
        className="size-7"
        aria-label="Settings"
        title="Settings (g s)"
        onClick={() => goTo('settings')}
      >
        <Gear />
      </Button>
    </header>
  );
}

function StatusBar() {
  const { data: status } = useTool('status', {});
  const selection = useWindow((s) => s.selection);
  const total = useWindow((s) => s.total);
  const message = useWindow((s) => s.message);
  const chat = useWindow((s) => s.chat);
  const job = status?.jobs.find((j) => j.status === 'running');
  const selected = selection.all ? total : selection.ids.size;
  const item = 'flex h-full items-center gap-1.5 px-2 hover:bg-surface-2 hover:text-foreground';
  return (
    <footer className="flex h-6 shrink-0 items-center border-t border-strong bg-background font-mono text-xs text-subtle">
      <span className="px-3">
        {formatCount(total ?? status?.files ?? 0)} files
        {selected ? ` · ${formatCount(selected)} selected` : ''}
      </span>
      <output
        aria-live="polite"
        className={cn('min-w-0 flex-1 truncate', message?.error && 'text-destructive')}
      >
        {message?.text}
      </output>
      {job && (
        <button type="button" className={item} onClick={() => goTo('activity')}>
          <LoaderCircle className="spin size-3" />
          {job.kind} {job.total ? Math.round((job.done / job.total) * 100) : 0}%
        </button>
      )}
      <button type="button" className={item} onClick={() => goTo('review')}>
        Review {formatCount(status?.reviews ?? 0)}
      </button>
      <button
        type="button"
        className={item}
        onClick={() => useWindow.setState({ overlay: 'shortcuts' })}
      >
        <Keyboard className="size-3" /> ?
      </button>
      <button
        type="button"
        aria-pressed={chat}
        className={cn(item, chat && 'text-foreground')}
        onClick={() => toggle('chat')}
      >
        <MessageSquare className="size-3" /> {keyLabel('mod+i')} Chat
      </button>
    </footer>
  );
}

function Shortcuts() {
  const open = useWindow((s) => s.overlay === 'shortcuts');
  const groups = Map.groupBy(
    commands.filter((c) => c.keys && !c.id.match(/^tab-[2-9]/)),
    (c) => c.group,
  );
  return (
    <Dialog
      open={open}
      onClose={() => useWindow.setState({ overlay: null })}
      title="Keyboard shortcuts"
      className="w-[50rem] max-w-[92vw]"
    >
      <div className="columns-2 gap-6 overflow-y-auto p-3">
        {[...groups].map(([group, list]) => (
          <section key={group} className="mb-3 break-inside-avoid">
            <h3 className="label mb-1">{group}</h3>
            {list.map((c) => (
              <div key={c.id} className="flex h-dense items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{c.title}</span>
                <span className="kbd">{keyLabel(c.keys!)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** The frame every view sits in: tabs, panes, status bar and overlays. */
export function App() {
  useEvents();
  useBindings();
  const query = useTabs((s) => activeTab(s).query);
  const activeId = useTabs((s) => s.activeId);
  const { screen } = useView();
  const { data: status, error } = useTool('status', {});
  const skipped = useWindow((s) => s.skipped);
  const chat = useWindow((s) => s.chat);
  const density = useWindow((s) => s.density);
  const scale = useWindow((s) => s.scale);
  // Latched, because the scan in step 2 adds a library while onboarding is still open.
  const [firstRun, setFirstRun] = useState(false);
  if (status && !status.libraries.length && !firstRun) setFirstRun(true);

  useEffect(() => {
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }, [query]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    document.documentElement.style.fontSize = `${scale * 100}%`;
  }, [density, scale]);

  if (error)
    return (
      <p role="alert" className="grid h-full place-items-center text-sm text-destructive">
        Could not reach the server: {error.message}
      </p>
    );
  if (!status) return null;
  if (firstRun && !skipped) return <Onboarding />;

  const View = screens[screen] ?? Browse;
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <Group id="shell" key={String(chat)} className="min-h-0 flex-1">
        <Panel id="view" minSize={480} className="flex h-full min-w-0 flex-col">
          {/* The key mounts only the active tab, with its own list and scroll state. */}
          <View key={activeId} />
        </Panel>
        {chat && (
          <Suspense>
            <Divider />
            <Chat />
          </Suspense>
        )}
      </Group>
      <StatusBar />
      <Palette />
      <Shortcuts />
    </div>
  );
}
