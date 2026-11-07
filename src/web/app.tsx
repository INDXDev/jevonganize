import { setLanguage, t, useLanguage } from './i18n/index.ts';
import {
  Activity as ActivityIcon,
  CheckCheck,
  Command as Search,
  Files,
  Keyboard,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Settings as Gear,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tags as TagsIcon,
  Contact,
  X,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { Job } from '../types.ts';
import { Group, Panel } from 'react-resizable-panels';
import { useEvents, useTool, useViewOptions } from './api.ts';
import { commands, useBindings } from './commands.ts';
import { Divider } from './components/pane.tsx';
import { Palette } from './components/palette.tsx';
import { Tour } from './components/tour.tsx';
import { Button } from './components/ui/button.tsx';
import { Dialog } from './components/ui/dialog.tsx';
import { Progress } from './components/ui/progress.tsx';
import { cn, formatCount, isDesktop, isMac, keyLabel } from './lib.ts';
import { activeTab, goTo, toggle, useTabs, useView, useWindow, type Theme } from './tabs.ts';
import { startTour, useTour } from './tour.ts';
import { SCREENS, titleOf, type Screen } from './view-query.ts';
import { Activity } from './views/activity.tsx';
import { Browse } from './views/browse.tsx';
import { Facets } from './views/facets.tsx';
import { Onboarding } from './views/onboarding.tsx';
import { Organize } from './views/organize.tsx';
import { Review } from './views/review.tsx';
import { Settings } from './views/settings.tsx';
import { Names } from './views/names.tsx';
import { Tags } from './views/tags.tsx';

const Chat = lazy(() => import('./views/chat.tsx'));

const screens: Record<Screen, { view: () => ReactNode; icon: LucideIcon }> = {
  browse: { view: Browse, icon: Files },
  organize: { view: Organize, icon: Sparkles },
  review: { view: Review, icon: CheckCheck },
  tags: { view: Tags, icon: TagsIcon },
  names: { view: Names, icon: Contact },
  facets: { view: Facets, icon: SlidersHorizontal },
  activity: { view: Activity, icon: ActivityIcon },
  settings: { view: Settings, icon: Gear },
};

const themes: { id: Theme; title: 'system' | 'light' | 'dark'; icon: LucideIcon }[] = [
  { id: 'system', title: 'system', icon: Monitor },
  { id: 'light', title: 'light', icon: Sun },
  { id: 'dark', title: 'dark', icon: Moon },
];

/** One click moves to the next theme, so the three need no menu. */
function ThemeButton() {
  const theme = useWindow((s) => s.theme);
  const at = themes.findIndex((entry) => entry.id === theme);
  const { title, icon: Icon } = themes[at]!;
  const next = themes[(at + 1) % themes.length]!;
  return (
    <Button
      variant="ghost"
      icon
      className="size-7"
      aria-label={t('Theme: {theme}. Switch to {next}', { theme: t(title), next: t(next.title) })}
      title={t('Theme: {theme}', { theme: t(title) })}
      onClick={() => useWindow.setState({ theme: next.id })}
    >
      <Icon />
    </Button>
  );
}

/** Every screen, always in view. The settings cog sits apart, at the bottom. */
function Rail({ active, reviews }: { active: Screen; reviews: number }) {
  const item = ({ id, title }: (typeof SCREENS)[number]) => {
    const Icon = screens[id].icon;
    const label = t(title);
    return (
      <button
        key={id}
        type="button"
        aria-label={label}
        aria-current={id === active ? 'page' : undefined}
        data-tour={`screen-${id}`}
        title={`${label} (g ${SCREENS.find((s) => s.id === id)!.key})`}
        onClick={() => goTo(id)}
        className={cn(
          'relative flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md text-2xs text-subtle hover:bg-surface-2 hover:text-foreground',
          id === active && 'bg-soft text-foreground',
        )}
      >
        <Icon className="size-4" />
        {label}
        {id === 'review' && reviews > 0 && (
          <span className="absolute top-0.5 right-1 rounded-full bg-primary px-1 font-mono text-2xs leading-3.5 text-primary-foreground">
            {reviews > 99 ? '99+' : reviews}
          </span>
        )}
      </button>
    );
  };
  return (
    <nav
      aria-label={t('Screens')}
      className="flex w-14 shrink-0 flex-col gap-0.5 border-r border-strong bg-background p-1"
    >
      {SCREENS.filter((s) => s.id !== 'settings').map(item)}
      <div className="mt-auto">{SCREENS.filter((s) => s.id === 'settings').map(item)}</div>
    </nav>
  );
}

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
      <div role="tablist" aria-label={t('Tabs')} className="flex min-w-0 items-center gap-0.5">
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
              {titleOf(tab.query)}
            </button>
            <button
              type="button"
              aria-label={t('Close {title}', { title: titleOf(tab.query) })}
              onClick={() => close(tab.id)}
              className="mr-1 grid size-4 shrink-0 place-items-center rounded-sm text-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          icon
          className="size-7"
          aria-label={t('New tab')}
          onClick={() => open()}
        >
          <Plus />
        </Button>
      </div>
      <button
        type="button"
        onClick={() => useWindow.setState({ overlay: 'palette' })}
        className="ml-auto flex h-6 w-56 shrink-0 items-center gap-2 rounded-md border bg-surface-1 px-2 text-sm text-subtle hover:border-strong"
      >
        <Search className="size-3" />
        {t('Search or run')}
        <span className="kbd ml-auto">{keyLabel('mod+k')}</span>
      </button>
      <ThemeButton />
    </header>
  );
}

const STATUS_ITEM =
  'flex h-full items-center gap-1.5 px-2 hover:bg-surface-2 hover:text-foreground';

function JobStatus({ job }: { job: Job }) {
  return (
    <button type="button" className={STATUS_ITEM} onClick={() => goTo('activity')}>
      <LoaderCircle className="spin size-3" />
      {t(job.kind)}
      {job.kind === 'scan' ? (
        <>
          <Progress label={t('Scanning')} className="w-20" /> {formatCount(job.done)}
        </>
      ) : (
        <>
          <Progress label={t(job.kind)} className="w-20" value={job.done} max={job.total || 1} />
          {job.total ? Math.round((job.done / job.total) * 100) : 0}%
        </>
      )}
    </button>
  );
}

function StatusBar() {
  // Events carry progress. This catches an end that was missed while reconnecting.
  const { data: status } = useTool(
    'status',
    {},
    {
      refetchInterval: (q) =>
        q.state.data?.jobs.some((j) => j.status === 'running') ? 3000 : false,
    },
  );
  const selection = useWindow((s) => s.selection);
  const total = useWindow((s) => s.total);
  const message = useWindow((s) => s.message);
  const chat = useWindow((s) => s.chat);
  const job = status?.jobs.find((j) => j.status === 'running');
  const selected = selection.all ? total : selection.ids.size;
  return (
    <footer className="flex h-6 shrink-0 items-center border-t border-strong bg-background font-mono text-xs text-subtle">
      <span className="px-3">
        {t('{count} files', { count: formatCount(total ?? status?.files ?? 0) })}
        {selected ? ` · ${t('{count} selected', { count: formatCount(selected) })}` : ''}
      </span>
      <output
        aria-live="polite"
        className={cn('min-w-0 flex-1 truncate', message?.error && 'text-destructive')}
      >
        {message?.text}
      </output>
      {job && <JobStatus job={job} />}
      <button type="button" className={STATUS_ITEM} onClick={() => goTo('review')}>
        {t('Review')} {formatCount(status?.reviews ?? 0)}
      </button>
      <button
        type="button"
        className={STATUS_ITEM}
        onClick={() => useWindow.setState({ overlay: 'shortcuts' })}
      >
        <Keyboard className="size-3" /> ?
      </button>
      <button
        type="button"
        aria-pressed={chat}
        className={cn(STATUS_ITEM, chat && 'text-foreground')}
        onClick={() => toggle('chat')}
      >
        <MessageSquare className="size-3" /> {keyLabel('mod+i')} {t('Chat')}
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
      title={t('Keyboard shortcuts')}
      className="w-[50rem] max-w-[92vw]"
    >
      <div className="columns-2 gap-6 overflow-y-auto p-3">
        {[...groups].map(([group, list]) => (
          <section key={group} className="mb-3 break-inside-avoid">
            <h3 className="label mb-1">{t(group)}</h3>
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
  const language = useLanguage();
  const { data: configData } = useTool('get_config', {}, { staleTime: Infinity });
  const savedLanguage = configData?.config.language;
  useEffect(() => {
    setLanguage(savedLanguage, configData?.system_language);
  }, [savedLanguage, configData?.system_language]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEvents();
  useBindings();
  const query = useTabs((s) => activeTab(s).query);
  const activeId = useTabs((s) => s.activeId);
  const { screen } = useView();
  const { data: status, error } = useTool('status', {});
  const options = useViewOptions();
  const skipped = useWindow((s) => s.skipped);
  const chat = useWindow((s) => s.chat);
  const density = useWindow((s) => s.density);
  const scale = useWindow((s) => s.scale);
  // Latched, because the scan in step 2 adds a library while onboarding is still open.
  const [firstRun, setFirstRun] = useState(false);
  if (status && !status.libraries.length && !firstRun) setFirstRun(true);
  const toured = useTour((s) => s.seen);
  const shell = !!status && !!options && !(firstRun && !skipped);
  // The tour follows setup, once per viewer. Later it starts only from Settings or the palette.
  useEffect(() => {
    if (shell && firstRun && !toured) startTour();
  }, [shell, firstRun, toured]);

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
        {t('Could not reach the server: {error}', { error: error.message })}
      </p>
    );
  if (!status || !options) return null;
  if (firstRun && !skipped) return <Onboarding />;

  const View = screens[screen].view;
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Rail active={screen} reviews={status.reviews} />
        <Group id="shell" key={String(chat)} className="min-w-0 flex-1">
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
      </div>
      <StatusBar />
      <Palette />
      <Shortcuts />
      <Tour />
    </div>
  );
}
