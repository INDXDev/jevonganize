/** PDF: text and metadata page by page, and rendering of the pages that hold too little text. */
import { readFile } from 'node:fs/promises';
import type { Budget } from '../core/config.ts';
import type { FileState } from '../types.ts';
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

type Resource = { doc: Pdf; texts?: Promise<string[]> };
const documents = new WeakMap<FileState, Map<string, Promise<Resource>>>();

function resource(path: string, state: FileState): Promise<Resource> {
  let owned = documents.get(state);
  if (!owned) documents.set(state, (owned = new Map()));
  let pending = owned.get(path);
  if (!pending) {
    pending = openPdf(path).then((doc) => ({ doc }));
    owned.set(path, pending);
  }
  return pending;
}

/** Releases every PDF owned by one extraction task, including partially failed pipelines. */
export async function closePdfs(state: FileState): Promise<void> {
  const owned = documents.get(state);
  documents.delete(state);
  for (const pending of owned?.values() ?? []) {
    const opened = await pending.catch(() => undefined);
    if (opened) await opened.doc.loadingTask.destroy();
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
  let opened: Resource;
  try {
    opened = await resource(file.path, state);
  } catch (error) {
    if ((error as Error).name !== 'PasswordException') throw error;
    return passwordProtected(state);
  }
  const { doc } = opened;
  const { info } = await getMeta(doc, { parseDates: true });
  put(state, 'pages', doc.numPages);
  put(state, 'title', info.Title);
  put(state, 'author', info.Author);
  put(state, 'producer', info.Producer);
  put(state, 'created', iso(info.CreationDate));
  opened.texts ??= pageTexts(doc, budget.pdf_pages);
  setText(state, (await opened.texts).join('\n\n'));
};

/** Adds page images for a PDF with thin text, such as a scan. Runs after `pdf`. */
export const pdfRender: Extractor = async (file, state, budget) => {
  if (
    state.metadata.pages === undefined ||
    file.images === false ||
    state.images.length >= budget.images ||
    budget.render_pages === 0
  )
    return;
  const opened = await resource(file.path, state);
  opened.texts ??= pageTexts(opened.doc, budget.pdf_pages);
  const pages = pagesToRender(await opened.texts, budget);
  if (!pages.length) return;
  const { default: sharp } = await import('sharp');
  for (const number of pages) {
    if (state.images.length >= budget.images) break;
    const png = await renderPage(opened.doc, number, budget.image_edge);
    await addImage(state, budget, sharp(png), `page-${number}`);
  }
};
