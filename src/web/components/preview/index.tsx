import { lazy, Suspense, useCallback, useState } from 'react';
import type { FileRow } from '../../../types.ts';
import { thumbUrl } from '../../api.ts';
import { FileIcon } from '../file-list.tsx';

const Pdf = lazy(() => import('./pdf.tsx'));
const Word = lazy(() => import('./word.tsx'));
const Text = lazy(() => import('./text.tsx'));

const isText = (mime: string) => /^text\/|json|xml|yaml|toml|javascript|typescript|x-sh/.test(mime);

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** One preview, chosen by `mime`. Used by the inspector and the Space overlay. */
export function Preview({ file, large }: { file: FileRow; large?: boolean }) {
  const mime = file.mime ?? '';
  const [failed, setFailed] = useState<number>();
  const onFail = useCallback(() => setFailed(file.id), [file.id]);
  const none = (
    <div className="grid h-full place-items-center gap-1 p-4 text-center text-xs text-subtle">
      <div>
        <FileIcon mime={file.mime} className="mx-auto mb-1 size-8 stroke-1" />
        No preview for {mime || 'this type'}
      </div>
    </div>
  );
  if (failed === file.id) return none;
  if (mime.startsWith('image/'))
    return (
      <img
        src={thumbUrl(file, 1024)}
        alt={`Preview of ${file.name}`}
        onError={onFail}
        className="size-full object-contain"
      />
    );
  const Kind = mime === 'application/pdf' ? Pdf : mime === DOCX ? Word : isText(mime) ? Text : null;
  if (!Kind) return none;
  return (
    <Suspense fallback={<div className="shimmer size-full bg-surface-2" />}>
      <Kind key={file.id} file={file} large={large} onFail={onFail} />
    </Suspense>
  );
}

export type KindProps = { file: FileRow; large?: boolean; onFail: () => void };
