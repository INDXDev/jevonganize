/** The top bar of the window: the tabs, the palette button and the theme switch. */
import { t } from '../i18n/index.ts';
import { Command as Search, Monitor, Moon, Plus, Sun, X, type LucideIcon } from 'lucide-react';
import { cn, isDesktop, isMac, keyLabel } from '../lib.ts';
import { useTabs, useWindow, type Theme } from '../tabs.ts';
import { titleOf } from '../view-query.ts';
import { Button } from './ui/button.tsx';

const THEMES: { id: Theme; title: 'system' | 'light' | 'dark'; icon: LucideIcon }[] = [
  { id: 'system', title: 'system', icon: Monitor },
  { id: 'light', title: 'light', icon: Sun },
  { id: 'dark', title: 'dark', icon: Moon },
];

/** One click moves to the next theme, so the three need no menu. */
function ThemeButton() {
  const theme = useWindow((s) => s.theme);
  const currentIndex = THEMES.findIndex((entry) => entry.id === theme);
  const { title, icon: Icon } = THEMES[currentIndex]!;
  const next = THEMES[(currentIndex + 1) % THEMES.length]!;
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

/** Every open tab, each with its close button, and the button for a new one. */
function TabStrip() {
  const { tabs, activeId, activate, close, open } = useTabs();
  return (
    <div role="tablist" aria-label={t('Tabs')} className="flex min-w-0 items-center gap-0.5">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const title = titleOf(tab.query);
        return (
          <div
            key={tab.id}
            className={cn(
              'group flex h-7 max-w-44 min-w-0 items-center rounded-md text-sm',
              isActive
                ? 'bg-surface-3 text-foreground'
                : 'text-muted-foreground hover:bg-surface-2',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => activate(tab.id)}
              className="min-w-0 truncate pr-1 pl-2.5"
            >
              {title}
            </button>
            <button
              type="button"
              aria-label={t('Close {title}', { title })}
              onClick={() => close(tab.id)}
              className="mr-1 grid size-4 shrink-0 place-items-center rounded-sm text-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
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
  );
}

/** The bar above everything. On the desktop app it is also what drags the window. */
export function TitleBar() {
  return (
    <header
      className={cn(
        'app-drag flex h-titlebar shrink-0 items-center gap-2 border-b border-strong bg-background pr-2 pl-3',
        // Room for the traffic lights: the desktop window uses `hiddenInset` on macOS.
        isDesktop && isMac && 'pl-20',
      )}
    >
      <img src="/icon.svg" alt="" className="size-5 shrink-0 rounded-sm" />
      <TabStrip />
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
