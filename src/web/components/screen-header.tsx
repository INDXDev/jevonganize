/** The strip at the top of a screen that names it, with controls beside the name. */
import type { ReactNode } from 'react';

/** A screen's heading. `children` sits beside it, such as a row of section buttons. */
export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex h-8 shrink-0 items-center gap-3 border-b border-strong bg-surface-1 px-3">
      <h2 className="label shrink-0">{title}</h2>
      {children}
    </header>
  );
}
