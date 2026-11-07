/** Opening a PDF with pdf.js, and drawing one of its pages as raw pixels. Worker code. */
import { readFile } from 'node:fs/promises';
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
import type { Sharp } from 'sharp';

const MAX_PDF_IMAGE_PIXELS = 2 ** 26;
const RGBA_CHANNELS = 4;

/** Opens a PDF for reading. The caller destroys it. */
export async function openPdf(path: string) {
  const { getDocumentProxy } = await import('unpdf');
  return getDocumentProxy(new Uint8Array(await readFile(path)), {
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    verbosity: 0, // pdf.js prints a line per odd font instruction, which floods the terminal
  });
}

/** An open pdf.js document. */
export type PdfDocument = Awaited<ReturnType<typeof openPdf>>;

/** The part of pdf.js's canvas factory a render goes through. */
interface CanvasFactory {
  create(...args: unknown[]): { canvas: Canvas; context: SKRSContext2D };
}

type PixelSize = { width: number; height: number };

/**
 * Makes the factory's canvases "encode" to their raw pixels, and records the size of the one
 * encoded. pdf.js makes scratch canvases here too, but only the page's own is ever encoded.
 */
function encodeAsRawPixels(factory: CanvasFactory, encodedSize: PixelSize): void {
  const createCanvas = factory.create.bind(factory);
  factory.create = (...args) => {
    const created = createCanvas(...args);
    const { canvas, context } = created;
    canvas.encode = async () => {
      Object.assign(encodedSize, { width: canvas.width, height: canvas.height });
      return context.getImageData(0, 0, canvas.width, canvas.height).data as unknown as Buffer;
    };
    return created;
  };
}

/**
 * Renders one page, its longest side `edge` pixels whatever size the page claims. unpdf only hands
 * back encoded images, so its canvas "encodes" to the raw pixels: a PNG costs more than the render.
 */
export async function renderPage(
  doc: PdfDocument,
  pageNumber: number,
  edge: number,
): Promise<Sharp> {
  const { renderPageAsImage } = await import('unpdf');
  const { default: sharp } = await import('sharp');
  const { width, height } = (await doc.getPage(pageNumber)).getViewport({ scale: 1 });
  const factory = doc.canvasFactory as CanvasFactory;
  const encodedSize = { width: 0, height: 0 };
  encodeAsRawPixels(factory, encodedSize);
  try {
    const pixels = await renderPageAsImage(doc, pageNumber, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: edge / Math.max(width, height),
    });
    return sharp(pixels, { raw: { ...encodedSize, channels: RGBA_CHANNELS } });
  } finally {
    delete (factory as Partial<CanvasFactory>).create; // back to the method on its prototype
  }
}
