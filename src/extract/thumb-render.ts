/** Draws a thumbnail. Worker code: the budget arrives with the task, so zod is never loaded here. */
import { randomUUID } from 'node:crypto';
import { lstat, rename, rm } from 'node:fs/promises';
import type { Sharp } from 'sharp';
import type { Budget } from '../core/config.ts';
import type { FileState } from '../types.ts';
import { extractors } from './extractors.ts';
import { picture } from './images.ts';
import { drawPage, type PageWords } from './page-image.ts';
import { openPdf, renderPage } from './pdf-document.ts';
import { closePdfs } from './pdf.ts';
import { sniff } from './sniff.ts';

/** First match wins. Which extractors give the text of a page thumbnail. */
const PAGE_SOURCES: [RegExp, string[]][] = [
  [/^message\/rfc822$/, ['eml']],
  [/^application\/vnd\.ms-outlook$/, ['msg']],
  [/^text\/html$/, ['office', 'text']],
  [/^text\//, ['text']],
  [/^application\/(vnd\.openxmlformats-|vnd\.oasis\.|rtf$|epub\+zip$)/, ['office']],
  [/^application\/(msword|vnd\.ms-)/, ['libreoffice']],
];

/** More than a page image can show, so that reading stops early. */
const PAGE_CHARS = 2000;
const IMAGE_PLACEHOLDER = /\[Image:[^\]]*\]/g;
const CONTROL_RUN = /[\p{Cc}\p{Cf}]+/gu;

/** A run of control characters becomes the line break or tab it holds, or else one space. */
const keepBreaks = (run: string) => /[\n\t]/.exec(run)?.[0] ?? ' ';

/** The words a page thumbnail shows, and its title if the file names one. Empty if it has none. */
async function pageWords(
  path: string,
  mime: string,
  deadline: number,
  budget: Budget,
): Promise<PageWords> {
  const extractorIds = PAGE_SOURCES.find(([pattern]) => pattern.test(mime))?.[1] ?? [];
  const { size } = await lstat(path);
  const file = { path, name: path, mime, size, deadline, images: false };
  const state: FileState = { text: '', images: [], metadata: {}, warnings: [] };
  try {
    // A failing extractor leaves less text, and a thumbnail with less on it is still a thumbnail.
    for (const id of extractorIds) {
      await extractors[id]!(file, state, budget).catch(() => undefined);
    }
  } finally {
    await closePdfs(state);
  }
  const { title } = state.metadata;
  return { title: typeof title === 'string' ? title.trim() : '', text: pageText(state.text) };
}

/** The start of a file's text, without image placeholders or control characters. */
const pageText = (text: string) =>
  text.slice(0, PAGE_CHARS).replace(IMAGE_PLACEHOLDER, '').replace(CONTROL_RUN, keepBreaks);

/** One thumbnail to draw: `edge` is its longest side in pixels, `outPath` the webp to write. */
interface ThumbnailTask {
  path: string;
  edge: number;
  outPath: string;
  deadline: number;
  budget: Budget;
}

async function firstPdfPage(path: string, edge: number): Promise<Sharp> {
  const doc = await openPdf(path);
  try {
    return await renderPage(doc, 1, edge);
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** The full-size image a thumbnail is cut from: the picture, a PDF's first page, or its words. */
async function sourceImage({ path, edge, deadline, budget }: ThumbnailTask): Promise<Sharp> {
  const mime = await sniff(path);
  if (mime.startsWith('image/')) return picture(path, mime);
  const { default: sharp } = await import('sharp');
  if (mime === 'application/pdf') return firstPdfPage(path, edge);
  const words = await pageWords(path, mime, deadline, budget);
  const hasWords = words.text.trim() !== '' || words.title !== '';
  if (!hasWords) throw new Error(`no thumbnail for ${mime}`);
  return sharp(await drawPage(mime, words, edge));
}

/** Worker task: writes the webp under a temp name, then renames it into place. */
export async function renderThumbnail(task: ThumbnailTask) {
  const tempPath = `${task.outPath}.${randomUUID()}.tmp`;
  const { edge } = task;
  try {
    const image = await sourceImage(task);
    await image
      .autoOrient()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .webp()
      .toFile(tempPath);
    await rename(tempPath, task.outPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
