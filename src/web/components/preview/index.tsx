import { t } from '../../i18n/index.ts';
import { lazy, Suspense, useCallback, useState } from 'react';
import type { FileRow } from '../../../types.ts';
import { thumbUrl } from '../../api.ts';
import { FileIcon } from '../file-icon.tsx';

const Pdf = lazy(() => import('./pdf.tsx'));
const Word = lazy(() => import('./word.tsx'));
const Text = lazy(() => import('./text.tsx'));
const Html = lazy(() => import('./html.tsx'));
const Media = lazy(() => import('./media.tsx'));

const isText = (mime: string) => /^text\/|json|xml|yaml|toml|javascript|typescript|x-sh/.test(mime);

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const KINDS = { pdf: Pdf, word: Word, html: Html, media: Media, text: Text };

/** The viewer for a type, or null when the server's thumbnail is the preview. */
function previewKind(mime: string): keyof typeof KINDS | null {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === DOCX) return 'word';
  if (mime === 'text/html') return 'html';
  if (/^(audio|video)\//.test(mime)) return 'media';
  return isText(mime) ? 'text' : null;
}

function NoPreview({ mime }: { mime: string | null }) {
  return (
    <div className="grid h-full place-items-center gap-1 p-4 text-center text-xs text-subtle">
      <div>
        <FileIcon mime={mime} className="mx-auto mb-1 size-8 stroke-1" />
        {t('No preview for {type}', { type: mime || t('this type') })}
      </div>
    </div>
  );
}

/** One preview, chosen by `mime`. Used by the inspector and the Space overlay. */
export function Preview({ file, large }: { file: FileRow; large?: boolean }) {
  const [failed, setFailed] = useState<number>();
  const onFail = useCallback(() => setFailed(file.id), [file.id]);
  if (failed === file.id) return <NoPreview mime={file.mime} />;
  const kind = previewKind(file.mime ?? '');
  // Pictures, and whatever else the server can draw: slides, sheets and mail.
  if (!kind)
    return (
      <img
        src={thumbUrl(file, 1024)}
        alt={t('Preview of {name}', { name: file.name })}
        onError={onFail}
        className="size-full object-contain"
      />
    );
  const Kind = KINDS[kind];
  return (
    <Suspense fallback={<div className="shimmer size-full bg-surface-2" />}>
      <Kind key={file.id} file={file} large={large} onFail={onFail} />
    </Suspense>
  );
}

export type KindProps = { file: FileRow; large?: boolean; onFail: () => void };
