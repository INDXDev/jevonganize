import { t } from '../i18n/index.ts';
import { Fragment } from 'react';
import { cn } from '../lib.ts';
import { setView } from '../tabs.ts';
import type { View } from '../view-query.ts';
import { TagChip } from './tag-chip.tsx';
import { Segmented } from './ui/field.tsx';

const MATCH = [
  { value: 'any', label: 'Any tag' },
  { value: 'all', label: 'All tags' },
] as const;

const without = (list: string[], tag: string) => list.filter((entry) => entry !== tag);

/** The tab's active filters, each removable. Browse and Organize share them, as they share a query. */
export function Filters({ view, className }: { view: View; className?: string }) {
  if (!view.tag.length && !view.not.length && !view.mime && !view.status) return null;
  const joiner = view.match === 'all' ? t('and') : t('or');
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {view.tag.map((tag, i) => (
        <Fragment key={tag}>
          {i > 0 && <span className="px-0.5 font-mono text-xs text-subtle">{joiner}</span>}
          <TagChip tag={tag} onRemove={() => setView({ tag: without(view.tag, tag) })} />
        </Fragment>
      ))}
      {view.tag.length > 1 && (
        <Segmented
          label={t('Files must have')}
          className="ml-1"
          value={view.match}
          options={MATCH.map((o) => ({ ...o, label: t(o.label) }))}
          onChange={(match) => setView({ match: match as View['match'] })}
        />
      )}
      {view.not.map((tag) => (
        <TagChip
          key={tag}
          tag={tag}
          negated
          onRemove={() => setView({ not: without(view.not, tag) })}
        />
      ))}
      {view.mime && (
        <TagChip
          tag={t('Type: {type}', { type: view.mime })}
          onRemove={() => setView({ mime: null })}
        />
      )}
      {view.status && (
        <TagChip
          tag={t('Status: {status}', { status: t(view.status) })}
          onRemove={() => setView({ status: null })}
        />
      )}
      <button
        type="button"
        onClick={() => setView({ tag: [], not: [], mime: null, status: null, match: null })}
        className="ml-1 text-xs text-subtle hover:text-foreground"
      >
        {t('Clear')}
      </button>
    </div>
  );
}
