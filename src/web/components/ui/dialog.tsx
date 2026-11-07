import { Dialog as RDialog } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib.ts';

/** The one overlay surface. Radix traps focus and returns it on close. */
export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hides the title visually, for overlays whose input says what they are. */
  bare?: boolean;
  className?: string;
  onKeyDown?: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const { open, onClose, title, bare, className, onKeyDown, children } = props;
  return (
    <RDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fade-in fixed inset-0 z-40 bg-black/50" />
        <RDialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className={cn(
            'overlay-in fixed top-[16vh] left-1/2 z-50 flex max-h-[68vh] w-[35rem] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-strong bg-popover shadow-overlay',
            className,
          )}
        >
          <RDialog.Title className={bare ? 'sr-only' : 'border-b px-3 py-2 text-sm font-medium'}>
            {title}
          </RDialog.Title>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
