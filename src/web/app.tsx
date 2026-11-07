/** The app's frame: the rail, the active screen, the bars and the overlays. */
import { t } from './i18n/index.ts';
import { lazy, Suspense, type ReactNode } from 'react';
import { Group, Panel } from 'react-resizable-panels';
import { useTool, useViewOptions } from './api.ts';
import { useBindings } from './bindings.ts';
import { useEvents } from './events.ts';
import { Divider } from './components/pane.tsx';
import { Palette } from './components/palette.tsx';
import { Rail } from './components/rail.tsx';
import { Shortcuts } from './components/shortcuts.tsx';
import { StatusBar } from './components/status-bar.tsx';
import { TitleBar } from './components/title-bar.tsx';
import { Tour } from './components/tour.tsx';
import { useAppLanguage, useDocumentState, useOnboarding } from './shell-state.ts';
import { useTabs, useView, useWindow } from './tabs.ts';
import type { Screen } from './screens.ts';
import { Browse } from './views/browse.tsx';
import { Dashboard } from './views/dashboard.tsx';
import { Facets } from './views/facets.tsx';
import { Folders } from './views/folders.tsx';
import { Onboarding } from './views/onboarding.tsx';
import { Settings } from './views/settings.tsx';
import { TagsScreen } from './views/tags.tsx';

const Chat = lazy(() => import('./views/chat.tsx'));

const SCREEN_VIEWS: Record<Screen, () => ReactNode> = {
  browse: Browse,
  folders: Folders,
  tags: TagsScreen,
  dashboard: Dashboard,
  facets: Facets,
  settings: Settings,
};

/** The active screen, with the chat pane beside it when that is open. */
function Workspace({ screen }: { screen: Screen }) {
  const activeId = useTabs((s) => s.activeId);
  const chatOpen = useWindow((s) => s.chat);
  const View = SCREEN_VIEWS[screen];
  return (
    <Group id="shell" key={String(chatOpen)} className="min-w-0 flex-1">
      <Panel id="view" minSize={480} className="flex h-full min-w-0 flex-col">
        {/* The key mounts only the active tab, with its own list and scroll state. */}
        <View key={activeId} />
      </Panel>
      {chatOpen && (
        <Suspense>
          <Divider />
          <Chat />
        </Suspense>
      )}
    </Group>
  );
}

/** The frame every view sits in: tabs, panes, status bar and overlays. */
export function App() {
  useAppLanguage();
  useDocumentState();
  useEvents();
  useBindings();
  const { screen } = useView();
  const { data: status, error } = useTool('status', {});
  const options = useViewOptions();
  const onboarding = useOnboarding(status, !!status && !!options);

  if (error)
    return (
      <p role="alert" className="grid h-full place-items-center text-sm text-destructive">
        {t('Could not reach the server: {error}', { error: error.message })}
      </p>
    );
  if (!status || !options) return null;
  if (onboarding) return <Onboarding />;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Rail active={screen} reviews={status.reviews} />
        <Workspace screen={screen} />
      </div>
      <StatusBar />
      <Palette />
      <Shortcuts />
      <Tour />
    </div>
  );
}
