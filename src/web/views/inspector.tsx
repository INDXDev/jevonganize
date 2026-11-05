import { useQueries } from '@tanstack/react-query';
import { FolderOpen, Plus } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { FileDetail, SimilarFile } from '../../types.ts';
import { act, call, editTags, resolveReviews, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { FileList } from '../components/file-list.tsx';
import { Pane } from '../components/pane.tsx';
import { Preview } from '../components/preview/index.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn, formatCount, formatDate, formatSize, shortPath } from '../lib.ts';
import { setView, useView, useWindow } from '../tabs.ts';

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

function Facts({ rows }: { rows: [string, ReactNode][] }) {
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
  const { data, isLoading } = useTool('similar_files', { id, limit: 12 });
  if (isLoading) return <p className="text-xs text-subtle">Finding neighbours</p>;
  return (
    <div className="-mx-1.5">
      <FileList
        mode="compact"
        label="Similar files, best first"
        rows={data}
        onOpen={(row) => setView({ file: row.id })}
        renderTrailing={(row) => <ScoreBar score={(row as SimilarFile).score} />}
        renderDetail={(row) =>
          (row as SimilarFile).shared.slice(0, 3).map((tag) => <TagChip key={tag} tag={tag} />)
        }
        empty={<p className="px-1.5 text-xs text-subtle">No file shares a weighted tag.</p>}
      />
    </div>
  );
}

function FileView({ file }: { file: FileDetail }) {
  const answers = file.answers.filter((a) => !a.refused);
  return (
    <>
      <div className="h-52 overflow-hidden bg-surface-2">
        <Preview file={file} />
      </div>
      <Section title="Facts">
        <Facts
          rows={[
            ['Kind', file.mime ?? 'unknown'],
            ['Size', formatSize(file.size)],
            ['Modified', formatDate(file.mtime_ms)],
            ['Status', file.status],
            [
              'Path',
              <span key="path" title={file.path}>
                {shortPath(file.path)}
              </span>,
            ],
          ]}
        />
      </Section>
      <Section
        title={`Tags ${file.tags.length}`}
        action={
          file.taggable && (
            <button
              type="button"
              aria-label="Add a tag"
              title="Add a tag (t)"
              onClick={() => useWindow.setState({ overlay: 'tag' })}
              className="text-subtle hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          )
        }
      >
        {!file.taggable && <p className="mb-1 text-xs text-warn">This volume cannot store tags.</p>}
        <div className="flex flex-wrap gap-1">
          {file.tags.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              onClick={() => setView({ tag: [tag], file: null })}
              onRemove={file.taggable ? () => void editTags(file.id, { remove: [tag] }) : undefined}
            />
          ))}
          {!file.tags.length && <p className="text-xs text-subtle">No tags yet.</p>}
        </div>
      </Section>
      {file.reviews.length > 0 && (
        <Section title="Pending">
          <ul className="space-y-1">
            {file.reviews.map((r) => (
              <li key={r.id} className="flex items-center gap-1">
                <span className="mr-auto min-w-0">
                  <TagChip tag={r.tag} confidence={r.confidence} />
                </span>
                <Button variant="ghost" onClick={() => void resolveReviews([r.id], true)}>
                  Accept
                </Button>
                <Button variant="ghost" onClick={() => void resolveReviews([r.id], false)}>
                  Reject
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {Object.keys(file.metadata).length > 0 && (
        <Fold title="Metadata">
          <Facts rows={Object.entries(file.metadata).map(([k, v]) => [k, String(v)])} />
        </Fold>
      )}
      {answers.length > 0 && (
        <Fold title="Answers">
          <table className="w-full font-mono text-xs text-muted-foreground">
            <tbody>
              {answers.map((a, i) => (
                <tr key={i}>
                  <td className="py-px text-subtle">{a.facet}</td>
                  <td>{a.value ?? 'other'}</td>
                  <td className="text-right">
                    {a.confidence?.toFixed(2) ?? 'n/a'}
                    {a.estimated && ' est.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fold>
      )}
      <Section title="Similar files">
        <Similar id={file.id} />
      </Section>
    </>
  );
}

function Selection() {
  const selection = useWindow((s) => s.selection);
  const total = useWindow((s) => s.total);
  const planId = useWindow((s) => s.planId);
  const ids = [...selection.ids];
  // shortcut: shared tags cover the first 50 selected ids. "All in query" shows none, as ids stay unknown.
  const files = useQueries({
    queries: ids.slice(0, 50).map((id) => ({
      queryKey: ['get_file', { id }],
      queryFn: () => call('get_file', { id }),
    })),
  });
  const rows = files.flatMap((f) => (f.data ? [f.data] : []));
  const shared = rows[0]?.tags.filter((t) => rows.every((r) => r.tags.includes(t))) ?? [];
  const { data: plan } = useTool('get_plan', { id: planId! }, { enabled: !!planId });
  const count = selection.all ? (total ?? 0) : ids.length;
  return (
    <div className="space-y-3 p-3">
      <div>
        <p className="font-mono text-2xl">{formatCount(count)}</p>
        <p className="text-sm text-muted-foreground">
          {selection.all ? 'files in this query' : 'files selected'}
        </p>
      </div>
      <Button onClick={() => useWindow.setState({ overlay: 'tag' })}>
        Tag all <span className="kbd">T</span>
      </Button>
      {!selection.all && (
        <div>
          <h3 className="label mb-1.5">Shared tags</h3>
          <div className="flex flex-wrap gap-1">
            {shared.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
            {!shared.length && <p className="text-xs text-subtle">None in common.</p>}
          </div>
        </div>
      )}
      {plan && <Block plan={plan} />}
    </div>
  );
}

function FolderInfo() {
  const view = useView();
  const { data: status } = useTool('status', {});
  const { data: tags } = useTool('list_tags', { folder: view.folder });
  const total = useWindow((s) => s.total);
  return (
    <div className="p-3">
      <h3 className="label mb-1.5">{view.folder ? shortPath(view.folder) : 'All libraries'}</h3>
      <Facts
        rows={[
          ['In this view', formatCount(total ?? 0)],
          ['Indexed', formatCount(status?.files ?? 0)],
          ['Organized', formatCount(status?.organized ?? 0)],
          ['Tags', formatCount(status?.tags ?? 0)],
          ['Provider', `${status?.provider} ${status?.model}`],
        ]}
      />
      <h3 className="label mt-4 mb-1.5">Top tags here</h3>
      <div className="flex flex-wrap gap-1">
        {tags
          ?.toSorted((a, b) => b.count - a.count)
          .slice(0, 14)
          .map((t) => (
            <TagChip
              key={t.tag}
              tag={t.tag}
              count={t.count}
              onClick={() => setView({ tag: [...view.tag, t.tag] })}
            />
          ))}
      </div>
      <p className="mt-4 text-xs text-subtle">
        Pick a file to see its tags and nearest neighbours.
      </p>
    </div>
  );
}

/** The right pane of the browser: one file, a selection, or the folder. */
export function Inspector() {
  const { file: id } = useView();
  const selection = useWindow((s) => s.selection);
  const many = selection.all || selection.ids.size > 1;
  const { data: file, error, isLoading } = useTool('get_file', { id }, { enabled: !!id && !many });

  useEffect(() => {
    if (!many) useWindow.setState({ planId: null });
  }, [many]);

  const showFile = !many && id;
  return (
    <Pane
      id="inspector"
      defaultSize="26%"
      minSize={260}
      maxSize="45%"
      title={
        showFile ? (
          <span title={file?.name}>{file?.name ?? ' '}</span>
        ) : many ? (
          'Selection'
        ) : (
          'Folder'
        )
      }
      actions={
        showFile &&
        file && (
          <Button
            variant="ghost"
            icon
            aria-label="Reveal in file manager"
            title="Reveal in file manager"
            onClick={() => void act('reveal_file', { id: file.id })}
          >
            <FolderOpen />
          </Button>
        )
      }
      loading={!many && !!id && isLoading}
      error={many ? null : error}
      className={cn(showFile && '[&>section:first-of-type]:border-t-0')}
    >
      {many ? <Selection /> : file && id ? <FileView file={file} /> : <FolderInfo />}
    </Pane>
  );
}
