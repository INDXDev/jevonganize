/** What the index says about a rule being built: how many files match, and tags worth adding. */
import { t } from '../i18n/index.ts';
import { keepPreviousData } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FolderRule } from '../../types.ts';
import type { VfolderTagSuggestions } from '../../tool-map.ts';
import { useTool } from '../api.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { formatCount } from '../lib.ts';

/** How long the rule must stay still before the index is asked again, so typing stays smooth. */
const SETTLE_MS = 150;

/** `rule`, once it has stayed the same for `SETTLE_MS`. Rules compare by their JSON. */
function useSettled(rule: FolderRule): FolderRule {
  const [settled, setSettled] = useState(rule);
  const key = JSON.stringify(rule);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(JSON.parse(key) as FolderRule), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return settled;
}

/** Asks `suggest_vfolder_tags` about `rule` once it settles, keeping the last answer meanwhile. */
export function useRuleHints(rule: FolderRule) {
  const settled = useSettled(rule);
  const { data } = useTool(
    'suggest_vfolder_tags',
    {
      tags: settled.tags,
      tag_match: settled.tag_match,
      exclude_tags: settled.exclude_tags,
      ...(settled.folder && { folder: settled.folder }),
    },
    { placeholderData: keepPreviousData },
  );
  return data;
}

/** "128 files match", announced politely as the rule changes. */
export function LiveCount({ hints }: { hints?: VfolderTagSuggestions }) {
  return (
    <output aria-live="polite" className="shrink-0 font-mono text-xs text-muted-foreground">
      {hints ? t('{count} files match', { count: formatCount(hints.matches) }) : ' '}
    </output>
  );
}

/** Beside Save while the rule matches nothing. Saving still works, for tags still to come. */
export function NoMatchWarning({ hints }: { hints?: VfolderTagSuggestions }) {
  if (hints?.matches !== 0) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-warn">
      <TriangleAlert aria-hidden className="size-3.5" />
      {t('No file matches this rule yet')}
    </span>
  );
}

/** The suggested tags, each with how many of the rule's files carry it. A click adds it. */
export function RuleHints(props: { hints?: VfolderTagSuggestions; onAdd: (tag: string) => void }) {
  const { hints, onAdd } = props;
  if (!hints?.suggestions.length) return null;
  return (
    <fieldset aria-label={t('Suggested tags')} className="mt-1 flex flex-wrap gap-1">
      {hints.suggestions.map((entry) => (
        <TagChip
          key={entry.tag}
          tag={entry.tag}
          count={entry.with_rule}
          onClick={() => onAdd(entry.tag)}
        />
      ))}
    </fieldset>
  );
}
