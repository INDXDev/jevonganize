import { t } from '../i18n/index.ts';
import { Check, Sparkles } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { TagColor } from '../../core/config.ts';
import { act, useTagColors } from '../api.ts';
import { cn } from '../lib.ts';
import { facetOf, HUES, tagColor, type Hue, type TagColors } from '../tag-colors.ts';

/** `auto` is stored rather than the key removed, because `set_config` merges. */
const setColor = (key: string, color: TagColor) =>
  void act('set_config', { tag_colors: { [key]: color } });

function Swatches({
  title,
  target,
  colors,
}: {
  title: string;
  target: string;
  colors?: TagColors;
}) {
  const current = colors && Object.hasOwn(colors, target) ? colors[target] : 'auto';
  return (
    <fieldset className="space-y-1">
      <legend className="truncate font-mono text-xs text-muted-foreground">{title}</legend>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t('Automatic colour for {target}', { target })}
          aria-pressed={current === 'auto'}
          title={t('Automatic')}
          onClick={() => setColor(target, 'auto')}
          className={cn(
            'grid size-5 place-items-center rounded-full border border-strong text-muted-foreground hover:text-foreground',
            current === 'auto' && 'border-primary text-primary',
          )}
        >
          <Sparkles className="size-3" />
        </button>
        {Object.entries(HUES).map(([hue, name]) => (
          <button
            key={hue}
            type="button"
            data-tag={hue}
            aria-label={t('{color} for {target}', { color: t(name), target })}
            aria-pressed={current === hue}
            title={t(name)}
            onClick={() => setColor(target, hue as Hue)}
            className="tag-dot grid size-5 place-items-center rounded-full text-surface-1 hover:opacity-80"
          >
            {current === hue && <Check className="size-3" strokeWidth={3} />}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A dot in the tag's colour. Choosing goes to `tag_colors`, for the tag or its whole facet. */
export function TagColorPicker({ tag }: { tag: string }) {
  const colors = useTagColors();
  const facet = facetOf(tag);
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={t('Colour of {tag}', { tag })}
        title={t('Change colour')}
        data-tag={tagColor(tag, colors)}
        className="tag-dot size-3 shrink-0 rounded-full hover:outline-2 hover:outline-offset-1 hover:outline-control"
      />
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 space-y-2 rounded-md border border-strong bg-popover p-2 shadow-overlay"
        >
          <Swatches title={tag} target={tag} colors={colors} />
          {facet !== tag && (
            <Swatches title={t('Every {facet}: tag', { facet })} target={facet} colors={colors} />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
