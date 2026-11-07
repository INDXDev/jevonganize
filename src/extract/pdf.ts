/** PDF: text and metadata page by page, and rendering of the pages that hold too little text. */
import type { Budget } from '../core/config.ts';
import type { FileState } from '../types.ts';
import { addImage } from './images.ts';
import { openPdf, type PdfDocument, renderPage } from './pdf-document.ts';
import { type Extractor, iso, passwordProtected, put, setText } from './source.ts';

/** A PDF opened once per task and shared by `pdf` and `pdfRender`, which read its texts once. */
type SharedPdf = { doc: PdfDocument; pageTexts?: Promise<string[]> };
/** Keyed by the task's state, so that the task's PDFs can be found and closed at its end. */
const pdfsByTask = new WeakMap<FileState, Map<string, Promise<SharedPdf>>>();

/** The task's PDF at `path`, opened on first use. */
function sharedPdf(path: string, state: FileState): Promise<SharedPdf> {
  const taskPdfs = pdfsByTask.get(state) ?? new Map<string, Promise<SharedPdf>>();
  pdfsByTask.set(state, taskPdfs);
  const opening = taskPdfs.get(path) ?? openPdf(path).then((doc) => ({ doc }));
  taskPdfs.set(path, opening);
  return opening;
}

/** Releases every PDF owned by one extraction task, including partially failed pipelines. */
export async function closePdfs(state: FileState): Promise<void> {
  const byPath = pdfsByTask.get(state);
  pdfsByTask.delete(state);
  for (const opening of byPath?.values() ?? []) {
    const opened = await opening.catch(() => undefined);
    if (opened) await opened.doc.loadingTask.destroy();
  }
}

/** Reads pages one by one, because `extractText` would walk all of a hostile 100,000-page file. */
async function readPageTexts(doc: PdfDocument, maxPages: number): Promise<string[]> {
  const texts: string[] = [];
  const lastPage = Math.min(doc.numPages, maxPages);
  for (let pageNumber = 1; pageNumber <= lastPage; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const { items } = await page.getTextContent();
    // Marked-content items carry no `str`, and so no text.
    const runs = items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''));
    texts.push(runs.join('').trim());
  }
  return texts;
}

const pageTextsOf = (shared: SharedPdf, budget: Budget) =>
  (shared.pageTexts ??= readPageTexts(shared.doc, budget.pdf_pages));

/** The page numbers worth rendering: none when text is sufficient, and blank pages before others. */
function pagesToRender(texts: string[], budget: Budget): number[] {
  const averageChars = texts.join('').length / texts.length;
  // Tested this way round because a PDF with no pages averages NaN, and has nothing to render.
  const textIsThin = averageChars < budget.thin_text_chars;
  if (!textIsThin) return [];
  const pages = texts.map((text, index) => ({ text, pageNumber: index + 1 }));
  const blankPages = pages.filter((page) => !page.text);
  const candidates = blankPages.length > 0 ? blankPages : pages;
  return candidates.slice(0, budget.render_pages).map((page) => page.pageNumber);
}

/** The shared PDF, or undefined when it needs a password. */
async function openUnlessLocked(path: string, state: FileState): Promise<SharedPdf | undefined> {
  try {
    return await sharedPdf(path, state);
  } catch (error) {
    if ((error as Error).name !== 'PasswordException') throw error;
    return undefined;
  }
}

/** Reads metadata and the text of the first `budget.pdf_pages` pages. */
export const pdf: Extractor = async (file, state, budget) => {
  const { getMeta } = await import('unpdf');
  const shared = await openUnlessLocked(file.path, state);
  if (!shared) return passwordProtected(state);
  const { info } = await getMeta(shared.doc, { parseDates: true });
  put(state, 'pages', shared.doc.numPages);
  put(state, 'title', info.Title);
  put(state, 'author', info.Author);
  put(state, 'producer', info.Producer);
  put(state, 'created', iso(info.CreationDate));
  setText(state, (await pageTextsOf(shared, budget)).join('\n\n'));
};

/** Adds page images for a PDF with thin text, such as a scan. Runs after `pdf`. */
export const pdfRender: Extractor = async (file, state, budget) => {
  const pdfWasRead = state.metadata.pages !== undefined;
  const pageImagesWanted = file.images !== false && budget.render_pages !== 0;
  const hasRoomForImages = state.images.length < budget.images;
  if (!pdfWasRead || !pageImagesWanted || !hasRoomForImages) return;
  const shared = await sharedPdf(file.path, state);
  const pageNumbers = pagesToRender(await pageTextsOf(shared, budget), budget);
  for (const pageNumber of pageNumbers) {
    if (state.images.length >= budget.images) break;
    const pageImage = await renderPage(shared.doc, pageNumber, budget.image_edge);
    await addImage(state, budget, pageImage, `page-${pageNumber}`);
  }
};
