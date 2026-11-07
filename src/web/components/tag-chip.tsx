import { t } from '../i18n/index.ts';
import { Ban, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { useTagColors } from '../api.ts';
import { cn, formatCount } from '../lib.ts';
import { tagColor } from '../tag-colors.ts';
import { FavoriteStar } from './favorite-star.tsx';

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
  /** Shows the favorite star, which pins the tag to the sidebar. */
  star?: boolean;
  /** A sidebar row: label only, because the facet is the group heading, unless `whole`. */
  row?: { checked: boolean; whole?: boolean; title?: string };
};

const split = (tag: string) => {
  const at = tag.indexOf(':');
  return at < 0 ? ['', tag] : [tag.slice(0, at + 1), tag.slice(at + 1)];
};

type RowProps = Pick<Props, 'tag' | 'onClick' | 'negated'> & {
  label: string;
  hue: string;
  checked: boolean;
  meta: ReactNode;
  title?: string;
};

function SidebarRow({ tag, label, hue, checked, meta, onClick, negated, title }: RowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked || negated}
      title={title ?? t('{tag} (Alt+click to exclude)', { tag })}
      className={cn(
        'flex h-dense w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        checked && 'bg-soft text-foreground',
        negated && 'text-foreground line-through',
      )}
    >
      <span aria-hidden data-tag={hue} className="tag-dot size-2 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta}
    </button>
  );
}

function RemoveButton({ tag, onRemove }: { tag: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={t('Remove {name}', { name: tag })}
      onClick={onRemove}
      className="grid h-full w-4 shrink-0 place-items-center rounded-r-sm hover:bg-surface-3 hover:text-foreground"
    >
      <X className="size-3" />
    </button>
  );
}

/** The chip's star. An unstarred one shows only on hover or focus, so chips stay quiet. */
function ChipStar({ tag }: { tag: string }) {
  return (
    <FavoriteStar
      tag={tag}
      className="h-full w-4 opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100"
    />
  );
}

/** The only way to show a tag. Text goes through React, so a hostile tag stays text. */
export function TagChip(props: Props) {
  const { tag, count, confidence, onRemove, onClick, negated, sign, star, row } = props;
  const [facet, label] = split(tag) as [string, string];
  const hue = tagColor(tag, useTagColors());
  const Body = onClick ? 'button' : 'span';
  const meta: ReactNode = count !== undefined && (
    <span className="font-mono text-xs text-muted-foreground tabular-nums">
      {formatCount(count)}
    </span>
  );

  if (row) {
    const rowProps = { tag, hue, meta, onClick, negated, title: row.title };
    return <SidebarRow {...rowProps} label={row.whole ? tag : label} checked={row.checked} />;
  }

  return (
    <span
      data-tag={hue}
      className={cn(
        'tag-chip group/chip inline-flex h-5 max-w-full items-center rounded-sm border font-mono text-xs',
        negated && 'border-dashed',
      )}
    >
      <Body
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        title={tag}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 truncate px-1.5',
          onClick && 'hover:underline',
        )}
      >
        {negated && <Ban className="size-3 shrink-0" aria-label={t('not')} />}
        {sign && <span>{sign}</span>}
        <span className="truncate">
          <span className="text-muted-foreground">{facet}</span>
          {label}
        </span>
        {meta}
        {confidence !== undefined && (
          <span className="text-muted-foreground tabular-nums">
            {confidence?.toFixed(2) ?? 'n/a'}
          </span>
        )}
      </Body>
      {star && <ChipStar tag={tag} />}
      {onRemove && <RemoveButton tag={tag} onRemove={onRemove} />}
    </span>
  );
}
