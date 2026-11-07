/** The frame every block shares: a coloured rule, a status icon, a title line and a command. */
import { Check, Circle, LoaderCircle, Undo2, X } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib.ts';

/** What state a block is in: waiting, running, done, failed or taken back. */
export type Tone = 'wait' | 'run' | 'ok' | 'bad' | 'off';

const TONES: Record<Tone, { rule: string; icon: ReactNode }> = {
  wait: { rule: 'bg-primary', icon: <Circle className="text-primary" /> },
  run: { rule: 'bg-primary', icon: <LoaderCircle className="spin text-primary" /> },
  ok: { rule: 'bg-ok', icon: <Check className="text-ok" /> },
  bad: { rule: 'bg-destructive', icon: <X className="text-destructive" /> },
  off: { rule: 'bg-control', icon: <Undo2 className="text-subtle" /> },
};

/** A block's frame. With `onKeyDown` it takes focus, so its keys work. */
export function BlockShell(props: {
  tone: Tone;
  title: ReactNode;
  meta?: ReactNode;
  /** The CLI line that does the same, shown under the title. */
  command?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  children?: ReactNode;
}) {
  const { tone, title, meta, command, children, onKeyDown } = props;
  return (
    // A block takes Enter and Mod+Enter itself, per the keyboard map, so it must hold focus.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={onKeyDown ? 0 : undefined}
      onKeyDown={onKeyDown}
      className="relative overflow-hidden rounded-md border bg-surface-2"
    >
      <span className={cn('absolute inset-y-0 left-0 w-0.5', TONES[tone].rule)} />
      <header className="flex items-center gap-2 pt-2 pr-2.5 pl-3">
        <span className="shrink-0 [&_svg]:size-3.5">{TONES[tone].icon}</span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
        <span className="shrink-0 font-mono text-xs text-subtle">{meta}</span>
      </header>
      {command && (
        <div className="group flex items-center gap-1.5 pt-0.5 pr-2.5 pl-3 font-mono text-xs text-subtle">
          <span aria-hidden className="text-muted-foreground">
            ❯
          </span>
          <code className="min-w-0 truncate">{command}</code>
        </div>
      )}
      <div className="space-y-2 pt-1.5 pr-2.5 pb-2.5 pl-3 text-sm">{children}</div>
    </article>
  );
}
