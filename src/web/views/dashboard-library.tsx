/** The Dashboard's view of the index: each library, kinds of file, the most used tags, the cache. */
import { t } from '../i18n/index.ts';
import type { LibraryReport } from '../../tool-map.ts';
import { TagChip } from '../components/tag-chip.tsx';
import { formatCount, formatDate, formatPercent, shortPath } from '../lib.ts';
import { setView } from '../tabs.ts';
import { DataTable } from './dashboard-table.tsx';

const percentOf = (part: number, whole: number) => formatPercent(whole ? part / whole : 0);

function Libraries({ libraries }: Pick<LibraryReport, 'libraries'>) {
  return (
    <DataTable
      caption={t('Libraries')}
      columns={[
        { title: t('Path') },
        { title: t('Files'), numeric: true },
        { title: t('Organized'), numeric: true },
        { title: t('Failed'), numeric: true },
        { title: t('Last scan'), numeric: true },
      ]}
      rows={libraries.map((library) => ({
        key: library.path,
        cells: [
          <span key="path" title={library.path}>
            {shortPath(library.path)}
          </span>,
          formatCount(library.files),
          percentOf(library.organized, library.files),
          formatCount(library.failed),
          library.scanned_at === null ? t('Never') : formatDate(library.scanned_at),
        ],
      }))}
    />
  );
}

function TopTags({ tags }: { tags: LibraryReport['top_tags'] }) {
  return (
    <section className="space-y-1">
      <h3 className="label">{t('Top tags')}</h3>
      <ul className="flex flex-wrap gap-1">
        {tags.map(({ tag, count }) => (
          <li key={tag}>
            <TagChip
              tag={tag}
              count={count}
              onClick={() => setView({ screen: 'browse', tag: [tag], section: null })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Libraries, kinds of file and top tags, with a line on the answer cache. */
export function LibrarySection({ library }: { library: LibraryReport }) {
  const { answers, hit_rate_30d } = library.cache;
  return (
    <div className="space-y-4">
      <Libraries libraries={library.libraries} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <DataTable
          caption={t('Kinds of file')}
          columns={[{ title: t('Kind') }, { title: t('Files'), numeric: true }]}
          rows={library.kinds.map((kind) => ({
            key: kind.mime_group,
            cells: [kind.mime_group, formatCount(kind.files)],
          }))}
        />
        <TopTags tags={library.top_tags} />
      </div>
      <p className="text-xs text-subtle">
        {t('Cached answers: {count} · reused in the last 30 days: {rate}', {
          count: formatCount(answers),
          rate: hit_rate_30d === null ? '–' : formatPercent(hit_rate_30d),
        })}
      </p>
    </div>
  );
}
