import { t } from '../i18n/index.ts';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { cn } from '../lib.ts';

const Scroller = createContext<HTMLDivElement | null>(null);

/** The element of the enclosing `Pane` that scrolls. */
export const usePaneScroller = () => useContext(Scroller);

type Props = {
  id: string;
  title?: ReactNode;
  actions?: ReactNode;
  /** Pinned above the scrolling body, under the title. */
  subheader?: ReactNode;
  /** Pinned under the scrolling body. */
  footer?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  /** Shown in place of the children when set. */
  empty?: ReactNode;
  defaultSize?: number | string;
  minSize?: number | string;
  maxSize?: number | string;
  className?: string;
  children?: ReactNode;
};

/** A resizable panel, and the only scroll container. Owns title and the empty, loading, error states. */
export function Pane(props: Props) {
  const { id, title, actions, footer, loading, error, empty, children, className } = props;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const state = error ? (
    <Notice icon={<CircleAlert className="size-4 text-destructive" />}>{error.message}</Notice>
  ) : loading ? (
    <Notice icon={<LoaderCircle className="spin size-4" />}>{t('Loading')}</Notice>
  ) : empty ? (
    <Notice>{empty}</Notice>
  ) : null;
  return (
    <Panel
      id={id}
      defaultSize={props.defaultSize}
      minSize={props.minSize}
      maxSize={props.maxSize}
      className="flex h-full min-w-0 flex-col bg-surface-1"
    >
      {(title || actions) && (
        <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
          {actions}
        </header>
      )}
      {props.subheader}
      <div ref={setScroller} className={cn('relative min-h-0 flex-1 overflow-y-auto', className)}>
        <Scroller value={scroller}>{state ?? children}</Scroller>
      </div>
      {footer && <footer className="shrink-0 border-t">{footer}</footer>}
    </Panel>
  );
}

function Notice({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-subtle">
      {icon}
      {children}
    </div>
  );
}

/** A row of panes whose sizes survive a reload. `panes` names the ones currently rendered. */
export function Panes(props: { id: string; panes: string[]; children: ReactNode }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: props.id,
    panelIds: props.panes,
    storage: localStorage,
  });
  return (
    <Group
      id={props.id}
      className="min-h-0 flex-1"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {props.children}
    </Group>
  );
}

export function Divider() {
  return (
    <Separator className="w-px bg-strong transition-colors duration-(--dur) hover:bg-primary data-[separator=active]:bg-primary" />
  );
}
