import { t } from '../i18n/index.ts';
import { useQueries } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useEffect } from 'react';
import type { FileDetail } from '../../types.ts';
import { act, call, useTool } from '../api.ts';
import { Block } from '../components/block.tsx';
import { Pane } from '../components/pane.tsx';
import { TagChip } from '../components/tag-chip.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn, formatCount, shortPath } from '../lib.ts';
import { setView, useView, useWindow } from '../tabs.ts';
import { Facts, FileView } from './inspector-file.tsx';

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
  const shared =
    rows[0]?.tags.filter((tagItem) => rows.every((r) => r.tags.includes(tagItem))) ?? [];
  const { data: plan } = useTool('get_plan', { id: planId! }, { enabled: !!planId });
  const count = selection.all ? (total ?? 0) : ids.length;
  return (
    <div className="space-y-3 p-3">
      <div>
        <p className="font-mono text-2xl">{formatCount(count)}</p>
        <p className="text-sm text-muted-foreground">
          {selection.all ? t('files in this query') : t('files selected')}
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
      {!selection.all && (
        <div>
          <h3 className="label mb-1.5">{t('Shared tags')}</h3>
          <div className="flex flex-wrap gap-1">
            {shared.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
            {!shared.length && <p className="text-xs text-subtle">{t('None in common.')}</p>}
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
        {tags
          ?.toSorted((a, b) => b.count - a.count)
          .slice(0, 14)
          .map((tagItem) => (
            <TagChip
              key={tagItem.tag}
              tag={tagItem.tag}
              count={tagItem.count}
              onClick={() => setView({ tag: [...view.tag, tagItem.tag] })}
            />
          ))}
      </div>
      <p className="mt-4 text-xs text-subtle">
        {t('Pick a file to see its tags and nearest neighbours.')}
      </p>
    </div>
  );
}

function RevealButton({ id }: { id: number }) {
  return (
    <Button
      variant="ghost"
      icon
      aria-label={t('Reveal in file manager')}
      title={t('Reveal in file manager')}
      onClick={() => void act('reveal_file', { id })}
    >
      <FolderOpen />
    </Button>
  );
}

function Subject(props: { many: boolean; id?: number; file?: FileDetail }) {
  const { many, id, file } = props;
  if (many) return <Selection />;
  if (file && id) return <FileView file={file} />;
  return <FolderInfo />;
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
  const otherTitle = many ? t('Selection') : t('Folder');
  return (
    <Pane
      id="inspector"
      defaultSize="26%"
      minSize={260}
      maxSize="45%"
      title={showFile ? <span title={file?.name}>{file?.name ?? ' '}</span> : otherTitle}
      actions={showFile && file && <RevealButton id={file.id} />}
      loading={!many && !!id && isLoading}
      error={many ? null : error}
      className={cn(showFile && '[&>section:first-of-type]:border-t-0')}
    >
      <Subject many={many} id={id} file={file} />
    </Pane>
  );
}
