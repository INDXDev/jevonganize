/** Folders worth saving, from `suggest_vfolders`, each made with one click. */
import { t } from '../i18n/index.ts';
import { CirclePlus, FolderPlus } from 'lucide-react';
import type { VfolderSuggestion } from '../../tool-map.ts';
import { act, useTool } from '../api.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { formatCount } from '../lib.ts';
import { openSavedFolder } from './folders-tree-row.tsx';

/** How many suggestions the tree lists, and how many cards the empty screen shows. */
const LISTED = 8;
const CARDS = 6;

/** Saves a suggestion as it is, then opens it. */
async function create(suggestion: VfolderSuggestion) {
  const saved = await act('save_vfolder', { name: suggestion.name, rule: suggestion.rule });
  if (saved) openSavedFolder(saved);
}

/** The label a suggestion's button reads out. */
const createLabel = ({ name }: VfolderSuggestion) => t('Create the folder {name}', { name });

/** The tree's Suggestions: a row per folder, with its count. */
export function SuggestedFolders() {
  const { data: suggestions = [] } = useTool('suggest_vfolders', { limit: LISTED });
  if (!suggestions.length) return null;
  return (
    <section aria-label={t('Suggestions')} className="pt-2">
      <h3 className="label px-2 pb-1">{t('Suggestions')}</h3>
      <ul>
        {suggestions.map((suggestion) => (
          <li key={suggestion.name}>
            <button
              type="button"
              aria-label={createLabel(suggestion)}
              title={createLabel(suggestion)}
              onClick={() => void create(suggestion)}
              className="flex h-dense w-full items-center gap-1.5 rounded-sm px-1 text-left text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              <CirclePlus aria-hidden className="size-3.5 shrink-0 text-subtle" />
              <span className="min-w-0 flex-1 truncate">{suggestion.name}</span>
              <span className="font-mono text-xs text-subtle">{formatCount(suggestion.count)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One big suggestion: its name, its rule as chips and its count. */
function SuggestionCard({ suggestion }: { suggestion: VfolderSuggestion }) {
  return (
    <button
      type="button"
      aria-label={createLabel(suggestion)}
      onClick={() => void create(suggestion)}
      className="flex flex-col gap-2 rounded-md border bg-surface-2 p-3 text-left hover:border-primary hover:bg-surface-3"
    >
      <span className="flex items-center gap-2">
        <FolderPlus aria-hidden className="size-4 shrink-0 text-subtle" />
        <span className="min-w-0 flex-1 truncate font-medium">{suggestion.name}</span>
        <span className="font-mono text-xs text-subtle">
          {t('{count} files', { count: formatCount(suggestion.count) })}
        </span>
      </span>
      <span className="flex flex-wrap gap-1">
        {suggestion.rule.tags.map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
      </span>
    </button>
  );
}

/** The screen with no folder yet: the best suggestions as cards, or a line on how to start. */
export function SuggestionCards() {
  const { data: suggestions = [] } = useTool('suggest_vfolders', { limit: LISTED });
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <h2 className="text-md font-medium">{t('No folders yet')}</h2>
        <p className="text-sm text-subtle">
          {suggestions.length
            ? t('Pick one to create it. A folder collects every file whose tags match its rule.')
            : t('No folders yet. A folder collects every file whose tags match its rule.')}
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
        {suggestions.slice(0, CARDS).map((suggestion) => (
          <SuggestionCard key={suggestion.name} suggestion={suggestion} />
        ))}
      </div>
    </div>
  );
}
