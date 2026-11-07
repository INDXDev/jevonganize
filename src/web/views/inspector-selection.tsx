import { t } from '../i18n/index.ts';
import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import type { FileDetail } from '../../types.ts';
import { call, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { formatCount } from '../lib.ts';
import { useWindow } from '../tabs.ts';
import { FolderDialog } from './folders-new-dialog.tsx';
import type { Editing } from './folders-tree-row.tsx';

/** How many selected files load for shared tags, as each is a request of its own. */
const SHARED_TAG_SAMPLE = 50;

/** The first selected files, loaded one by one. "All in query" loads none, as its ids stay unknown. */
function useSelectedFiles(ids: number[]): FileDetail[] {
  const fileQueries = useQueries({
    queries: ids.slice(0, SHARED_TAG_SAMPLE).map((id) => ({
      queryKey: ['get_file', { id }],
      queryFn: () => call('get_file', { id }),
    })),
  });
  return fileQueries.flatMap((query) => (query.data ? [query.data] : []));
}

/** The tags every one of `files` has. */
function sharedTags(files: FileDetail[]): string[] {
  const [first, ...rest] = files;
  if (!first) return [];
  return first.tags.filter((tag) => rest.every((file) => file.tags.includes(tag)));
}

function SharedTags({ tags }: { tags: string[] }) {
  return (
    <div>
      <h3 className="label mb-1.5">{t('Shared tags')}</h3>
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {!tags.length && <p className="text-xs text-subtle">{t('None in common.')}</p>}
      </div>
    </div>
  );
}

/** Opens a new virtual folder whose rule is every tag the selected files share. */
function FolderFromFiles({ tags }: { tags: string[] }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const seed = { tags, tag_match: 'all' as const };
  return (
    <>
      <Button
        variant="ghost"
        disabled={!tags.length}
        title={tags.length ? undefined : t('None in common.')}
        onClick={() => setEditing({ parent: null, seed })}
      >
        {t('Make a folder from these files')}
      </Button>
      <FolderDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/**
 * Several files at once: how many, the bulk tag buttons, their shared tags with a folder made from
 * them, and the last plan.
 */
export function Selection() {
  const selection = useWindow((s) => s.selection);
  const total = useWindow((s) => s.total);
  const planId = useWindow((s) => s.planId);
  const ids = [...selection.ids];
  const shared = sharedTags(useSelectedFiles(ids));
  const { data: plan } = useTool('get_plan', { id: planId ?? '' }, { enabled: !!planId });
  const isWholeQuery = selection.all;
  const fileCount = isWholeQuery ? (total ?? 0) : ids.length;
  return (
    <div className="space-y-3 p-3">
      <div>
        <p className="font-mono text-2xl">{formatCount(fileCount)}</p>
        <p className="text-sm text-muted-foreground">
          {isWholeQuery ? t('files in this query') : t('files selected')}
        </p>
      </div>
      <div className="flex gap-1.5">
        <Button onClick={() => useWindow.setState({ overlay: 'tag' })}>
          {' '}
          {t('Tag all')} <span className="kbd">T</span>
        </Button>
        <Button variant="ghost" onClick={() => useWindow.setState({ overlay: 'untag' })}>
          {' '}
          {t('Remove a tag')} <span className="kbd">⇧T</span>
        </Button>
      </div>
      {!isWholeQuery && <SharedTags tags={shared} />}
      {!isWholeQuery && <FolderFromFiles tags={shared} />}
      {plan && <Block plan={plan} />}
    </div>
  );
}
