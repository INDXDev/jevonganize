import { t } from '../i18n/index.ts';
import { ExternalLink, FolderOpen } from 'lucide-react';
import { useEffect } from 'react';
import type { FileDetail } from '../../types.ts';
import { act, useTool } from '../api.ts';
import { Pane } from '../components/pane.tsx';
import { Button } from '../components/ui/button.tsx';
import { cn } from '../lib.ts';
import { useView, useWindow } from '../tabs.ts';
import { FileView } from './inspector-file.tsx';
import { FolderInfo } from './inspector-folder.tsx';
import { Selection } from './inspector-selection.tsx';

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

function OpenButton({ id }: { id: number }) {
  return (
    <Button
      variant="ghost"
      icon
      aria-label={t('Open in default app')}
      title={t('Open in default app')}
      onClick={() => void act('open_file', { id })}
    >
      <ExternalLink />
    </Button>
  );
}

/** What the pane shows: the selection, the open file, or else the folder. */
function Subject(props: { isMany: boolean; id?: number; file?: FileDetail }) {
  const { isMany, id, file } = props;
  if (isMany) return <Selection />;
  if (file && id) return <FileView file={file} />;
  return <FolderInfo />;
}

/** The right pane of the browser: one file, a selection, or the folder. */
export function Inspector() {
  const { file: id } = useView();
  const selection = useWindow((s) => s.selection);
  const isMany = selection.all || selection.ids.size > 1;
  const showsFile = !isMany && !!id;
  const { data: file, error, isLoading } = useTool('get_file', { id }, { enabled: showsFile });

  // A bulk plan belongs to the selection, so it goes when the selection does.
  useEffect(() => {
    if (!isMany) useWindow.setState({ planId: null });
  }, [isMany]);

  const otherTitle = isMany ? t('Selection') : t('Folder');
  const fileActions = showsFile && file && (
    <>
      <OpenButton id={file.id} />
      <RevealButton id={file.id} />
    </>
  );
  return (
    <Pane
      id="inspector"
      defaultSize="26%"
      minSize={260}
      maxSize="45%"
      title={showsFile ? <span title={file?.name}>{file?.name ?? ' '}</span> : otherTitle}
      actions={fileActions}
      loading={showsFile && isLoading}
      error={isMany ? null : error}
      className={cn(showsFile && '[&>section:first-of-type]:border-t-0')}
    >
      <Subject isMany={isMany} id={id} file={file} />
    </Pane>
  );
}
