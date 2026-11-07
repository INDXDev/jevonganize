import { t } from '../i18n/index.ts';
import { useTool } from '../api.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { formatCount, shortPath } from '../lib.ts';
import { setView, useView, useWindow } from '../tabs.ts';
import { Facts } from './inspector-file.tsx';

/** How many of the folder's tags show, most used first. */
const TOP_TAG_COUNT = 14;

/** No file open: counts for the folder and the library, and its most used tags as filters. */
export function FolderInfo() {
  const view = useView();
  const { data: status } = useTool('status', {});
  const { data: tags = [] } = useTool('list_tags', { folder: view.folder });
  const total = useWindow((s) => s.total);
  const topTags = tags.toSorted((a, b) => b.count - a.count).slice(0, TOP_TAG_COUNT);
  const addFilter = (tag: string) => setView({ tag: [...view.tag, tag] });
  return (
    <div className="p-3">
      <h3 className="label mb-1.5">{view.folder ? shortPath(view.folder) : t('All libraries')}</h3>
      <Facts
        rows={[
          [t('In this view'), formatCount(total ?? 0)],
          [t('Indexed'), formatCount(status?.files ?? 0)],
          [t('Organized'), formatCount(status?.organized ?? 0)],
          [t('Tags'), formatCount(status?.tags ?? 0)],
          [t('Provider'), `${status?.provider} ${status?.model}`],
        ]}
      />
      <h3 className="label mt-4 mb-1.5">{t('Top tags here')}</h3>
      <div className="flex flex-wrap gap-1">
        {topTags.map((entry) => (
          <TagChip
            key={entry.tag}
            tag={entry.tag}
            count={entry.count}
            onClick={() => addFilter(entry.tag)}
          />
        ))}
      </div>
      <p className="mt-4 text-xs text-subtle">
        {t('Pick a file to see its tags and nearest neighbours.')}
      </p>
    </div>
  );
}
