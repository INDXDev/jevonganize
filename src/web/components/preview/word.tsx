import { useEffect, useState } from 'react';
import { fileUrl, useTool } from '../../api.ts';
import type { KindProps } from './index.tsx';

const style = `<style>body{font:13px/1.5 system-ui,sans-serif;color:#ededef;background:#141518;margin:12px}</style>`;

/** `mammoth` output is untrusted, so it renders in a sandboxed frame with no scripts. */
export default function Word({ file, onFail }: KindProps) {
  const [html, setHtml] = useState<string>();
  const { data } = useTool('get_config', {});
  const limit = (data?.config.budget as { max_parse_mb?: number } | undefined)?.max_parse_mb;
  const tooBig = limit !== undefined && file.size > limit * 1e6;

  useEffect(() => {
    if (tooBig) return onFail();
    let live = true;
    void (async () => {
      try {
        const [{ default: mammoth }, bytes] = await Promise.all([
          import('mammoth'),
          fetch(fileUrl(file.id)).then((r) => r.arrayBuffer()),
        ]);
        const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes });
        if (live) setHtml(value);
      } catch {
        if (live) onFail();
      }
    })();
    return () => {
      live = false;
    };
  }, [file.id, tooBig, onFail]);

  if (html === undefined) return <div className="shimmer size-full bg-surface-2" />;
  return (
    <iframe
      sandbox=""
      title={`Preview of ${file.name}`}
      srcDoc={style + html}
      className="size-full bg-surface-1"
    />
  );
}
