import { t } from '../i18n/index.ts';
import { Maximize2, Plus, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { FileDetail, SimilarFile } from '../../types.ts';
import { act, editTags, resolveReviews, useTool } from '../api.ts';
import { FileList } from '../components/file-list.tsx';
import { Preview } from '../components/preview/index.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn, formatDate, formatSize, shortPath } from '../lib.ts';
import { notify, setView, useWindow } from '../tabs.ts';

function Section(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t px-3 py-2.5">
      <div className="mb-1.5 flex h-4 items-center justify-between">
        <h3 className="label">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-t px-3 py-2">
      <summary className="label flex cursor-default list-none items-center gap-1 hover:text-foreground">
        <span className="transition-transform group-open:rotate-90">▸</span>
        {title}
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

/** A two-column list of labels and values. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="truncate text-subtle">{key}</dt>
          <dd className="truncate font-mono text-xs leading-[1.125rem] text-muted-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden className="h-0.5 w-8 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full bg-primary" style={{ width: `${score * 100}%` }} />
      </span>
      <span className="font-mono text-xs text-muted-foreground">{score.toFixed(2)}</span>
    </span>
  );
}

function Similar({ id }: { id: number }) {
  const [limit, setLimit] = useState(12);
  const { data, isLoading } = useTool('similar_files', { id, limit });
  if (isLoading) return <p className="text-xs text-subtle">{t('Finding neighbours')}</p>;
  return (
    <div className="-mx-1.5">
      <FileList
        mode="compact"
        label={t('Similar files, best first')}
        rows={data}
        onOpen={(row) => setView({ file: row.id })}
        renderTrailing={(row) => <ScoreBar score={(row as SimilarFile).score} />}
        renderDetail={(row) =>
          (row as SimilarFile).shared.slice(0, 3).map((tag) => <TagChip key={tag} tag={tag} />)
        }
        empty={<p className="px-1.5 text-xs text-subtle">{t('No file shares a weighted tag.')}</p>}
      />
      {data?.length === limit && (
        <button
          type="button"
          onClick={() => setLimit(limit * 4)}
          className="px-1.5 text-xs text-subtle hover:text-foreground"
        >
          {t('More')}
        </button>
      )}
    </div>
  );
}

function SuggestButton({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);
  const suggest = async () => {
    setBusy(true);
    const items = await act('suggest_tags', { id });
    setBusy(false);
    if (items) notify(t('{count} suggestions, under Pending', { count: items.length }));
  };
  return (
    <button
      type="button"
      aria-label={t('Suggest tags')}
      title={t('Ask the chat model for new tags. This sends the file to the provider')}
      disabled={busy}
      onClick={() => void suggest()}
      className="text-subtle hover:text-foreground disabled:opacity-50"
    >
      <Sparkles className={cn('size-3.5', busy && 'shimmer')} />
    </button>
  );
}

function PreviewFrame({ file }: { file: FileDetail }) {
  return (
    <div className="relative h-[46vh] min-h-52 overflow-hidden bg-surface-2">
      <Preview file={file} />
      <Button
        variant="ghost"
        icon
        aria-label={t('Open a large preview')}
        title={t('Large preview (Space)')}
        className="absolute bottom-1.5 left-1.5 size-6 border border-strong bg-surface-2"
        onClick={() => useWindow.setState({ overlay: 'preview' })}
      >
        <Maximize2 />
      </Button>
    </div>
  );
}

function FileFacts({ file }: { file: FileDetail }) {
  return (
    <Section title={t('Facts')}>
      <Facts
        rows={[
          [t('Kind'), file.mime ?? t('Unknown')],
          [t('Size'), formatSize(file.size)],
          [t('Modified'), formatDate(file.mtime_ms)],
          [t('Status'), t(file.status)],
          [
            t('Path'),
            <span key="path" title={file.path}>
              {shortPath(file.path)}
            </span>,
          ],
        ]}
      />
    </Section>
  );
}

function TagActions({ id }: { id: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <SuggestButton id={id} />
      <button
        type="button"
        aria-label={t('Add a tag')}
        title={t('Add a tag (t)')}
        onClick={() => useWindow.setState({ overlay: 'tag' })}
        className="text-subtle hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
    </span>
  );
}

function FileTags({ file }: { file: FileDetail }) {
  return (
    <Section
      title={t('Tags {count}', { count: file.tags.length })}
      action={file.taggable && <TagActions id={file.id} />}
    >
      {!file.taggable && (
        <p className="mb-1 text-xs text-warn">{t('This volume cannot store tags.')}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {file.tags.map((tag) => (
          <TagChip
            key={tag}
            tag={tag}
            onClick={() => setView({ tag: [tag], file: null })}
            onRemove={file.taggable ? () => void editTags(file.id, { remove: [tag] }) : undefined}
          />
        ))}
        {!file.tags.length && <p className="text-xs text-subtle">{t('No tags yet.')}</p>}
      </div>
    </Section>
  );
}

function PendingReviews({ reviews }: { reviews: FileDetail['reviews'] }) {
  if (!reviews.length) return null;
  return (
    <Section title={t('Pending')}>
      <ul className="space-y-1">
        {reviews.map((review) => (
          <li key={review.id} className="flex items-center gap-1">
            <span className="mr-auto min-w-0">
              <TagChip tag={review.tag} confidence={review.confidence} />
            </span>
            <Button variant="ghost" onClick={() => void resolveReviews([review.id], true)}>
              {t('Accept')}
            </Button>
            <Button variant="ghost" onClick={() => void resolveReviews([review.id], false)}>
              {t('Reject')}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Metadata({ metadata }: { metadata: FileDetail['metadata'] }) {
  const entries = Object.entries(metadata);
  if (!entries.length) return null;
  return (
    <Fold title={t('Metadata')}>
      <Facts rows={entries.map(([key, value]) => [key, String(value)])} />
    </Fold>
  );
}

function Answers({ answers }: { answers: FileDetail['answers'] }) {
  const given = answers.filter((answer) => !answer.refused);
  if (!given.length) return null;
  return (
    <Fold title={t('Answers')}>
      <table className="w-full font-mono text-xs text-muted-foreground">
        <tbody>
          {given.map((answer, i) => (
            <tr key={i}>
              <td className="py-px text-subtle">{answer.facet}</td>
              <td>{answer.value ?? t('Other answer')}</td>
              <td className="text-right">
                {answer.confidence?.toFixed(2) ?? t('Not available')}
                {answer.estimated && t(' est.')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Fold>
  );
}

/** Everything about one file: preview, facts, tags, pending reviews and similar files. */
export function FileView({ file }: { file: FileDetail }) {
  return (
    <>
      <PreviewFrame file={file} />
      <FileFacts file={file} />
      <FileTags file={file} />
      <PendingReviews reviews={file.reviews} />
      <Metadata metadata={file.metadata} />
      <Answers answers={file.answers} />
      <Section title={t('Similar files')}>
        <Similar id={file.id} />
      </Section>
    </>
  );
}
