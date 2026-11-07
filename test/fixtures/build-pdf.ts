/** Builds small PDF files by hand, so the fixtures hold exactly the objects a test needs. */

/** The body of one PDF object. Objects are numbered by their place in the list, from 1. */
type PdfObject = string | Buffer;

/** A JPEG to draw on every page as the image `/Im0`. */
interface PdfImage {
  width: number;
  height: number;
  jpeg: Buffer;
}

/** What a PDF holds besides its pages. */
export interface PdfOptions {
  /** The body of an `/Info` dictionary. */
  info?: string;
  image?: PdfImage;
  /** Extra trailer entries. `$EXTRA` stands for the number of the first extra object. */
  trailer?: string;
  /** Objects added after all the others, such as an `/Encrypt` dictionary. */
  extraObjects?: string[];
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';
const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

const imageStream = ({ width, height, jpeg }: PdfImage) =>
  Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    ),
    jpeg,
    Buffer.from('\nendstream'),
  ]);

const contentStream = (content: string) =>
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

const pageObject = (stream: number, image: string) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${stream} 0 R ` +
  `/Resources << /Font << /F1 3 0 R >> ${image} >> >>`;

const pagesObject = (kids: number[]) =>
  `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] >>`;

/** Writes the objects out with a cross-reference table, so a reader can find each by offset. */
function serialize(objects: PdfObject[], trailerRefs: string): Buffer {
  const header = Buffer.from('%PDF-1.4\n');
  const bodies = objects.map((body, index) =>
    Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(body), Buffer.from('\nendobj\n')]),
  );
  const offsets: number[] = [];
  let end = header.length;
  for (const body of bodies) {
    offsets.push(end);
    end += body.length;
  }
  const xref = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const size = objects.length + 1;
  const tail =
    `xref\n0 ${size}\n0000000000 65535 f \n${xref}trailer\n` +
    `<< /Size ${size} /Root 1 0 R ${trailerRefs} >>\nstartxref\n${end}\n%%EOF\n`;
  return Buffer.concat([header, ...bodies, Buffer.from(tail)]);
}

/** Builds a PDF. Each page is a content stream in Helvetica, which may draw the image. */
export function pdf(pages: string[], options: PdfOptions = {}): Buffer {
  const objects: PdfObject[] = [CATALOG, '', HELVETICA]; // the page tree is filled in below
  const add = (body: PdfObject) => objects.push(body); // the new length is the object's number
  const image = options.image ? `/XObject << /Im0 ${add(imageStream(options.image))} 0 R >>` : '';
  const kids = pages.map((content) => add(pageObject(add(contentStream(content)), image)));
  objects[1] = pagesObject(kids);
  const info = options.info ? add(options.info) : 0;
  const extra = (options.extraObjects ?? []).map((body) => add(body));
  const infoRef = info ? `/Info ${info} 0 R ` : '';
  const trailer = (options.trailer ?? '').replace('$EXTRA', String(extra[0]));
  return serialize(objects, infoRef + trailer);
}

/** A page of text lines, 14 points apart, from the top left. */
export const textPage = (lines: string[]) =>
  `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET`;

/** Eight numbered lines of fictional minutes. */
export const filler = (label: string) =>
  Array.from(
    { length: 8 },
    (_, line) => `${label} line ${line}: the Harbor Lantern Society met to review minutes.`,
  );

/** A hex string of `bytes` bytes, for a PDF dictionary. */
export const hexBytes = (bytes: number) => '<' + 'ab'.repeat(bytes) + '>';

/** A page that draws the image `/Im0` over the whole page. */
export const IMAGE_PAGE = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
