import { t } from '../i18n/index.ts';
import {
  Files,
  FolderTree,
  LayoutDashboard,
  Settings,
  SlidersHorizontal,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib.ts';
import { goTo } from '../tabs.ts';
import { SCREENS, type Screen } from '../screens.ts';

const SCREEN_ICONS: Record<Screen, LucideIcon> = {
  browse: Files,
  folders: FolderTree,
  tags: Tags,
  dashboard: LayoutDashboard,
  facets: SlidersHorizontal,
  settings: Settings,
};

/** The badge counts up to this, then shows `99+`, so it stays one chip wide. */
const MAX_BADGE = 99;

function RailButton(props: { screen: (typeof SCREENS)[number]; active: boolean; reviews: number }) {
  const { screen, active, reviews } = props;
  const Icon = SCREEN_ICONS[screen.id];
  const label = t(screen.title);
  // Review is a section of Tags, so the count of pending reviews rides on Tags.
  const showBadge = screen.id === 'tags' && reviews > 0;
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-tour={`screen-${screen.id}`}
      title={`${label} (g ${screen.key})`}
      onClick={() => goTo(screen.id)}
      className={cn(
        'relative flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md py-1 text-center text-2xs leading-tight text-subtle hover:bg-surface-2 hover:text-foreground',
        active && 'bg-soft text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
      {showBadge && (
        <span className="absolute top-0.5 right-1 rounded-full bg-primary px-1 font-mono text-2xs leading-3.5 text-primary-foreground">
          {reviews > MAX_BADGE ? `${MAX_BADGE}+` : reviews}
        </span>
      )}
    </button>
  );
}

/** Every screen, always in view. The settings cog sits apart, at the bottom. */
export function Rail({ active, reviews }: { active: Screen; reviews: number }) {
  const button = (screen: (typeof SCREENS)[number]) => (
    <RailButton key={screen.id} screen={screen} active={screen.id === active} reviews={reviews} />
  );
  return (
    <nav
      aria-label={t('Screens')}
      className="flex w-14 shrink-0 flex-col gap-0.5 border-r border-strong bg-background p-1"
    >
      {SCREENS.filter((screen) => screen.id !== 'settings').map(button)}
      <div className="mt-auto">
        {SCREENS.filter((screen) => screen.id === 'settings').map(button)}
      </div>
    </nav>
  );
}
