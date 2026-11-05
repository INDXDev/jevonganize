import { useEffect, useState } from 'react';
import { fileUrl } from '../../api.ts';
import type { KindProps } from './index.tsx';

const LIMIT = 256 * 1024;

/** The first 256 KiB as text. HTML shows as source and is never rendered. */
export default function Text({ file, onFail }: KindProps) {
  const [text, setText] = useState<string>();

  useEffect(() => {
    const abort = new AbortController();
    fetch(fileUrl(file.id), {
      headers: { range: `bytes=0-${LIMIT - 1}` },
      signal: abort.signal,
    })
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('unreadable'))))
      // A server without range support sends everything, and the cut is made here.
      .then((bytes) => setText(new TextDecoder().decode(bytes.slice(0, LIMIT))))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') onFail();
      });
    return () => abort.abort();
  }, [file.id, onFail]);

  if (text === undefined) return <div className="shimmer size-full bg-surface-2" />;
  return (
    <div className="size-full overflow-auto">
      <pre className="p-2.5 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
      {file.size > LIMIT && <p className="px-2.5 pb-2 text-xs text-subtle">Cut off at 256 KiB.</p>}
    </div>
  );
}
