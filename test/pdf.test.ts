import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '../src/core/config.ts';
import { closePdfs, pdf, pdfRender } from '../src/extract/pdf.ts';
import type { FileState } from '../src/types.ts';
import { join } from 'node:path';
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  meta: vi.fn<() => Promise<{ info: Record<string, string> }>>(),
  render: vi.fn<() => Promise<Uint8Array>>(),
  text: vi.fn<() => Promise<{ items: { str: string; hasEOL: boolean }[] }>>(),
  close: vi.fn<() => Promise<void>>(),
}));
vi.mock('unpdf', () => ({
  getDocumentProxy: mock.open,
  getMeta: mock.meta,
  renderPageAsImage: mock.render,
}));
const budget = configSchema.parse({}).budget;
const file = () => ({
  path: join(import.meta.dirname, 'fixtures/files/report.pdf'),
  name: 'report.pdf',
  mime: 'application/pdf',
  size: 1,
  deadline: Date.now() + 30000,
});
const state = (): FileState => ({ text: '', images: [], metadata: {}, warnings: [] });
beforeEach(() => {
  vi.resetAllMocks();
  mock.text.mockResolvedValue({ items: [{ str: 'enough text '.repeat(100), hasEOL: true }] });
  mock.open.mockResolvedValue({
    numPages: 2,
    getPage: async () => ({ getTextContent: mock.text }),
    loadingTask: { destroy: mock.close },
  });
  mock.meta.mockResolvedValue({ info: {} });
});

describe('task-owned PDFs', () => {
  it('opens once, reads each page once, and closes after all steps', async () => {
    const output = state();
    try {
      await pdf(file(), output, budget);
      await pdfRender(file(), output, budget);
    } finally {
      await closePdfs(output);
    }
    expect(mock.open).toHaveBeenCalledTimes(1);
    expect(mock.text).toHaveBeenCalledTimes(2);
    expect(mock.render).not.toHaveBeenCalled();
    expect(mock.close).toHaveBeenCalledTimes(1);
    expect(output.metadata).toEqual({ pages: 2 });
  });
  it('skips rendering when images are disabled or the render budget is empty', async () => {
    mock.text.mockResolvedValue({ items: [] });
    const output = state();
    try {
      await pdf(file(), output, budget);
      await pdfRender({ ...file(), images: false }, output, budget);
      await pdfRender(file(), output, { ...budget, render_pages: 0 });
      await pdfRender(file(), output, { ...budget, images: 0 });
    } finally {
      await closePdfs(output);
    }
    expect(mock.render).not.toHaveBeenCalled();
    expect(mock.open).toHaveBeenCalledTimes(1);
    expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('closes a document even if a later step failed, without retaining it for the next task', async () => {
    mock.meta.mockRejectedValueOnce(new Error('metadata failed'));
    const output = state();
    await expect(pdf(file(), output, budget)).rejects.toThrow('metadata failed');
    await closePdfs(output);
    await pdf(file(), output, budget);
    await closePdfs(output);
    expect(mock.open).toHaveBeenCalledTimes(2);
    expect(mock.close).toHaveBeenCalledTimes(2);
  });
});
