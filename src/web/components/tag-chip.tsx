import { Ban, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '../lib.ts';

type Props = {
  tag: string;
  count?: number;
  /** Null shows `n/a`, never 0. */
  confidence?: number | null;
  onRemove?: () => void;
  onClick?: (e: MouseEvent) => void;
  /** Filtered out, in `not`. */
  negated?: boolean;
  /** Marks an addition or removal in a plan. */
  sign?: '+' | '−';
  /** A sidebar row: label only, because the facet is the group heading. */
  row?: { checked: boolean };
};

const split = (tag: string) => {
  const at = tag.indexOf(':');
  return at < 0 ? ['', tag] : [tag.slice(0, at + 1), tag.slice(at + 1)];
};

/** The only way to show a tag. Text goes through React, so a hostile tag stays text. */
export function TagChip(props: Props) {
  const { tag, count, confidence, onRemove, onClick, negated, sign, row } = props;
  const [facet, label] = split(tag) as [string, string];
  const Body = onClick ? 'button' : 'span';
  const meta: ReactNode = count !== undefined && (
    <span className="font-mono text-xs text-subtle tabular-nums">
      {count.toLocaleString('en-US')}
    </span>
  );

  if (row)
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={row.checked || negated}
        title={`${tag} (Alt+click to exclude)`}
        className={cn(
          'flex h-dense w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          row.checked && 'bg-soft text-foreground',
          negated && 'text-foreground line-through',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta}
      </button>
    );

  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center rounded-sm border bg-surface-2 font-mono text-xs',
        negated && 'border-dashed border-control',
      )}
    >
      <Body
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        title={tag}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 truncate px-1.5',
          onClick && 'hover:text-primary',
        )}
      >
        {negated && <Ban className="size-3 shrink-0 text-subtle" aria-label="not" />}
        {sign && <span className="text-subtle">{sign}</span>}
        <span className="truncate">
          <span className="text-muted-foreground">{facet}</span>
          {label}
        </span>
        {meta}
        {confidence !== undefined && (
          <span className="text-subtle tabular-nums">{confidence?.toFixed(2) ?? 'n/a'}</span>
        )}
      </Body>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${tag}`}
          onClick={onRemove}
          className="grid h-full w-4 shrink-0 place-items-center rounded-r-sm text-subtle hover:bg-surface-3 hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
