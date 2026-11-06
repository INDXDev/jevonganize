/** PDF: text and metadata page by page, and rendering of the pages that hold too little text. */
import { readFile } from 'node:fs/promises';
import type { Budget } from '../core/config.ts';
import { addImage } from './images.ts';
import { type Extractor, iso, passwordProtected, put, setText } from './source.ts';

const MAX_PDF_IMAGE_PIXELS = 2 ** 26;

/** Opens a PDF for reading. The caller destroys it. */
export async function openPdf(path: string) {
  const { getDocumentProxy } = await import('unpdf');
  return getDocumentProxy(new Uint8Array(await readFile(path)), {
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    verbosity: 0, // pdf.js prints a line per odd font instruction, which floods the terminal
  });
}

type Pdf = Awaited<ReturnType<typeof openPdf>>;

/** Like `openPdf`, with undefined for a file that needs a password. */
async function openUnlessLocked(path: string): Promise<Pdf | undefined> {
  try {
    return await openPdf(path);
  } catch (error) {
    if ((error as Error).name !== 'PasswordException') throw error;
    return undefined;
  }
}

/** Renders one page as a PNG, its longest side `edge` pixels whatever size the page claims. */
export async function renderPage(doc: Pdf, number: number, edge: number): Promise<Uint8Array> {
  const { renderPageAsImage } = await import('unpdf');
  const { width, height } = (await doc.getPage(number)).getViewport({ scale: 1 });
  return renderPageAsImage(doc, number, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale: edge / Math.max(width, height),
  });
}

/** Reads pages one by one, because `extractText` would walk all of a hostile 100,000-page file. */
async function pageTexts(doc: Pdf, limit: number): Promise<string[]> {
  const texts: string[] = [];
  for (let number = 1; number <= Math.min(doc.numPages, limit); number++) {
    const { items } = await (await doc.getPage(number)).getTextContent();
    const parts = items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''));
    texts.push(parts.join('').trim());
  }
  return texts;
}

/** The page numbers worth rendering: none when text is sufficient, and blank pages before others. */
function pagesToRender(texts: string[], budget: Budget): number[] {
  const average = texts.join('').length / texts.length;
  // Written this way round because a PDF with no pages averages NaN, and has nothing to render.
  if (!(average < budget.thin_text_chars)) return [];
  const pages = texts.map((text, index) => ({ text, number: index + 1 }));
  const blank = pages.filter((page) => !page.text);
  return (blank.length ? blank : pages).slice(0, budget.render_pages).map((page) => page.number);
}

/** Reads metadata and the text of the first `budget.pdf_pages` pages. */
export const pdf: Extractor = async (file, state, budget) => {
  const { getMeta } = await import('unpdf');
  const doc = await openUnlessLocked(file.path);
  if (!doc) return passwordProtected(state);
  try {
    const { info } = await getMeta(doc, { parseDates: true });
    put(state, 'pages', doc.numPages);
    put(state, 'title', info.Title);
    put(state, 'author', info.Author);
    put(state, 'producer', info.Producer);
    put(state, 'created', iso(info.CreationDate));
    setText(state, (await pageTexts(doc, budget.pdf_pages)).join('\n\n'));
  } finally {
    await doc.loadingTask.destroy();
  }
};

/** Adds page images for a PDF with thin text, such as a scan. Runs after `pdf`. */
export const pdfRender: Extractor = async (file, state, budget) => {
  if (state.metadata.pages === undefined) return; // `pdf` could not open it, and has said why
  const { default: sharp } = await import('sharp');
  const doc = await openPdf(file.path);
  try {
    const texts = await pageTexts(doc, budget.pdf_pages);
    for (const number of pagesToRender(texts, budget)) {
      const png = await renderPage(doc, number, budget.image_edge);
      await addImage(state, budget, sharp(png), `page-${number}`);
    }
  } finally {
    await doc.loadingTask.destroy();
  }
};
