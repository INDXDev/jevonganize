import { t } from '../i18n/index.ts';
import { Star } from 'lucide-react';
import { act, useTool } from '../api.ts';
import { cn } from '../lib.ts';

/** The starred tags in their order, from `list_favorite_tags`, and a test for one tag. */
export function useFavorites() {
  const { data: favorites = [] } = useTool('list_favorite_tags', {});
  const isFavorite = (tag: string) => favorites.some((favorite) => favorite.tag === tag);
  return { favorites, isFavorite };
}

/**
 * Stars or unstars a tag. With `position`, a starred tag moves there, 0 first. It changes only the
 * saved list: no file gains or loses a tag.
 */
export const setFavorite = (tag: string, favorite: boolean, position?: number) =>
  act('set_favorite_tag', { tag, favorite, position });

/**
 * The one star toggle for a tag: filled while the tag is in Favorites, and a click adds or removes
 * it. Put it anywhere a tag shows; `className` sizes and places it.
 */
export function FavoriteStar({ tag, className }: { tag: string; className?: string }) {
  const { isFavorite } = useFavorites();
  const isStarred = isFavorite(tag);
  return (
    <button
      type="button"
      aria-label={t('Favorite {tag}', { tag })}
      aria-pressed={isStarred}
      title={isStarred ? t('Remove from favorites') : t('Add to favorites')}
      onClick={() => void setFavorite(tag, !isStarred)}
      className={cn(
        'grid shrink-0 place-items-center text-subtle hover:text-foreground',
        isStarred && 'text-warn',
        className,
      )}
    >
      <Star className={cn('size-3', isStarred && 'fill-current')} />
    </button>
  );
}
