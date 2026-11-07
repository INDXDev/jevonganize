import { t } from '../i18n/index.ts';
import type { DragEvent, KeyboardEvent } from 'react';
import type { FavoriteTag } from '../../tool-map.ts';
import { act } from '../api.ts';
import { setFavorite, useFavorites } from '../components/favorite-star.tsx';
import { usePlanDialog } from '../components/plan-dialog.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { useFileDrop } from '../file-drag.ts';
import { cn } from '../lib.ts';
import { setView } from '../tabs.ts';
import type { View } from '../view-query.ts';
import { SidebarGroup } from './browse-sidebar-tags.tsx';

/** A favorite row being dragged to a new place. The data is the tag, which only names a row. */
const REORDER_TYPE = 'application/x-jevonganize-favorite';

/** Called with a favorite's tag and the ids of the files dropped on it. */
type TagFiles = (tag: string, fileIds: number[]) => void;

/** Reordering by drag: a row dropped on another takes that row's place. */
function reorderHandlers(tag: string, position: number) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(REORDER_TYPE, tag);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(REORDER_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e: DragEvent) => {
      const moved = e.dataTransfer.getData(REORDER_TYPE);
      if (!moved) return;
      e.preventDefault();
      if (moved !== tag) void setFavorite(moved, true, position);
    },
  };
}

/** Alt+Up and Alt+Down move a row, so reordering also works without a mouse. */
function moveByKey(e: KeyboardEvent, tag: string, position: number) {
  const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
  if (!e.altKey || !step) return;
  e.preventDefault();
  void setFavorite(tag, true, Math.max(0, position + step));
}

/** One favorite: a click filters the tab to its tag, Alt+click excludes it, and files dropped on it get it. */
function FavoriteRow(props: { favorite: FavoriteTag; view: View; onFiles: TagFiles }) {
  const { favorite, view, onFiles } = props;
  const { tag, position } = favorite;
  const fileDrop = useFileDrop((fileIds) => onFiles(tag, fileIds));
  const reorder = reorderHandlers(tag, position);
  return (
    <div
      role="presentation"
      {...reorder}
      onDragOver={(e) => {
        fileDrop.handlers.onDragOver(e);
        reorder.onDragOver(e);
      }}
      onDragLeave={fileDrop.handlers.onDragLeave}
      onDrop={(e) => {
        fileDrop.handlers.onDrop(e);
        reorder.onDrop(e);
      }}
      onKeyDown={(e) => moveByKey(e, tag, position)}
      className={cn('rounded-sm', fileDrop.isOver && 'outline-2 outline-primary')}
    >
      <TagChip
        tag={tag}
        count={favorite.count}
        row={{
          checked: view.tag.length === 1 && view.tag[0] === tag,
          whole: true,
          title: t('{tag}: drop files to tag them, drag to reorder, Alt+click to exclude', { tag }),
        }}
        negated={view.not.includes(tag)}
        onClick={(e) => setView(e.altKey ? { not: [...view.not, tag] } : { tag: [tag] })}
      />
    </div>
  );
}

/**
 * Files dropped on a favorite: a plan that adds its tag, shown as a block. Nothing is written until
 * Apply, as with every tag write.
 */
function useTagFiles() {
  const plans = usePlanDialog();
  const tagFiles = async (tag: string, fileIds: number[]) => {
    if (!fileIds.length) return;
    const title = t('Add {tag} to {count} files', { tag, count: fileIds.length });
    const plan = await act('propose_changes', { file_ids: fileIds, add: [tag], title });
    if (plan) plans.show(plan.id);
  };
  return { tagFiles, dialog: plans.dialog };
}

/** The sidebar's favorite tags, in the order the person chose. */
export function FavoritesSection({ view }: { view: View }) {
  const { favorites } = useFavorites();
  const { tagFiles, dialog } = useTagFiles();
  return (
    <SidebarGroup title={t('Favorites')} tour="favorites">
      {favorites.map((favorite) => (
        <FavoriteRow
          key={favorite.tag}
          favorite={favorite}
          view={view}
          onFiles={(tag, fileIds) => void tagFiles(tag, fileIds)}
        />
      ))}
      {!favorites.length && (
        <p className="px-2 text-xs text-subtle">{t('Press ☆ on a tag to pin it here')}</p>
      )}
      {dialog}
    </SidebarGroup>
  );
}
