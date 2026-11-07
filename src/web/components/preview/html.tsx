import { t } from '../../i18n/index.ts';
import { useEffect, useState } from 'react';
import { fileUrl } from '../../api.ts';
import { Segmented } from '../ui/field.tsx';
import { Frame } from './frame.tsx';
import type { KindProps } from './index.tsx';
import Text from './text.tsx';

const LIMIT = 16 * 2 ** 20;

/** The charset a page declares in its first bytes, else UTF-8. An unknown label is not a failure. */
function decode(bytes: ArrayBuffer) {
  const start = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  try {
    return new TextDecoder(/charset=["']?([\w-]+)/i.exec(start)?.[1]).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** The page as it looks, in `Frame`, or its source. Its own scripts and links do nothing. */
export default function Html({ file, large, onFail }: KindProps) {
  const [html, setHtml] = useState<string>();
  const [view, setView] = useState('page');

  useEffect(() => {
    const abort = new AbortController();
    fetch(fileUrl(file.id), { headers: { range: `bytes=0-${LIMIT - 1}` }, signal: abort.signal })
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('unreadable'))))
      .then((bytes) => setHtml(decode(bytes.slice(0, LIMIT))))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') onFail();
      });
    return () => abort.abort();
  }, [file.id, onFail]);

  if (html === undefined) return <div className="shimmer size-full bg-surface-2" />;
  return (
    <div className="relative size-full">
      {view === 'page' ? (
        <Frame
          title={t('Preview of {name}', { name: file.name })}
          html={html}
          className="bg-white"
        />
      ) : (
        <Text file={file} large={large} onFail={onFail} />
      )}
      <Segmented
        label={t('HTML view')}
        className="absolute top-1.5 right-1.5 bg-surface-2"
        value={view}
        options={[
          { value: 'page', label: t('Page') },
          { value: 'source', label: t('Source') },
        ]}
        onChange={setView}
      />
    </div>
  );
}
