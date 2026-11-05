import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
// oxlint-disable-next-line import/default -- `?url` is Vite's, and always has a default
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '../../api.ts';
import { Button } from '../ui/button.tsx';
import type { KindProps } from './index.tsx';

GlobalWorkerOptions.workerSrc = worker;

/** One page at a time, so only what is visible is rendered. */
export default function Pdf({ file, large, onFail }: KindProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    const task = getDocument({ url: fileUrl(file.id) });
    // Destroying a task rejects it, which is not a failed file.
    task.promise.then(setDoc, () => live && onFail());
    return () => {
      live = false;
      void task.destroy();
    };
  }, [file.id, onFail]);

  useEffect(() => {
    const target = canvas.current;
    let live = true;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    void doc?.getPage(page).then((p) => {
      // Two renders on one canvas throw, so a stale effect must stop before it starts.
      if (!live || !target) return;
      const scale = ((large ? 900 : 400) / p.getViewport({ scale: 1 }).width) * devicePixelRatio;
      const viewport = p.getViewport({ scale });
      target.width = viewport.width;
      target.height = viewport.height;
      task = p.render({ canvas: target, viewport });
      task.promise.catch(() => {});
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, page, large]);

  return (
    <div className="relative flex size-full justify-center overflow-hidden bg-surface-3 p-2">
      <canvas ref={canvas} className="max-h-full max-w-full object-contain" />
      {doc && doc.numPages > 1 && (
        <div className="absolute right-1.5 bottom-1.5 flex items-center rounded-md border border-strong bg-surface-2 font-mono text-xs">
          <Button
            variant="ghost"
            icon
            aria-label="Previous page"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft />
          </Button>
          {page}/{doc.numPages}
          <Button
            variant="ghost"
            icon
            aria-label="Next page"
            disabled={page === doc.numPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
