/** Builds zip archives and minimal Office Open XML packages, with fictional document properties. */
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';

/** Zips the entries in order, with ZipCrypto when a password is given. */
export async function zip(
  entries: Record<string, string | Uint8Array>,
  password?: string,
): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    password,
    zipCrypto: Boolean(password),
    useWebWorkers: false,
  });
  for (const [name, body] of Object.entries(entries)) {
    const reader = typeof body === 'string' ? new TextReader(body) : new Uint8ArrayReader(body);
    await writer.add(name, reader);
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006';
const SPREADSHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const CORE_PROPERTIES =
  `${XML}<cp:coreProperties xmlns:cp="${PACKAGE}/metadata/core-properties" ` +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>Lantern Festival Plan</dc:title><dc:creator>Mira Quill</dc:creator>' +
  '<cp:lastModifiedBy>Oren Vale</cp:lastModifiedBy>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">2024-03-15T09:30:00Z</dcterms:created>' +
  '</cp:coreProperties>';

const APP_PROPERTIES =
  `${XML}<Properties xmlns="${OFFICE}/extended-properties">` +
  '<Company>Harbor Lantern Society</Company></Properties>';

const PROPERTY_PARTS = {
  '/docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
  '/docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};

const relationship = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;

/** The package relationships: the main part, then the two property parts. */
const packageRels = (main: string, type: string) =>
  `${XML}<Relationships xmlns="${PACKAGE}/relationships">` +
  relationship('rId1', `${OFFICE}/relationships/${type}`, main) +
  relationship('rId2', `${PACKAGE}/relationships/metadata/core-properties`, 'docProps/core.xml') +
  relationship('rId3', `${OFFICE}/relationships/extended-properties`, 'docProps/app.xml') +
  '</Relationships>';

/** The content types: defaults for XML and relationships, and an override per named part. */
function contentTypes(overrides: Record<string, string>): string {
  const parts = Object.entries({ ...overrides, ...PROPERTY_PARTS })
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join('');
  return (
    `${XML}<Types xmlns="${PACKAGE}/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    `<Default Extension="xml" ContentType="application/xml"/>${parts}</Types>`
  );
}

/** A package whose main part is `main`, with the shared properties and then `parts`. */
interface PackageParts {
  main: string;
  relationship: string;
  types: Record<string, string>;
  parts: Record<string, string>;
}

const officePackage = ({ main, relationship: type, types, parts }: PackageParts) =>
  zip({
    '[Content_Types].xml': contentTypes(types),
    '_rels/.rels': packageRels(main, type),
    'docProps/core.xml': CORE_PROPERTIES,
    'docProps/app.xml': APP_PROPERTIES,
    ...parts,
  });

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A Word document of two paragraphs. */
export const docx = () =>
  officePackage({
    main: 'word/document.xml',
    relationship: 'officeDocument',
    types: {
      '/word/document.xml':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    },
    parts: {
      'word/document.xml':
        `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        paragraph('The lantern parade begins at the old pier at dusk.') +
        paragraph('Volunteers meet at the ferry gate.') +
        '</w:body></w:document>',
    },
  });

const SHEETS = Array.from({ length: 7 }, (_, index) => index + 1);
const ROWS = Array.from({ length: 60 }, (_, index) => index + 1);

/** A row with a label in A and the row number times the sheet number in B. */
const row = (sheet: number, r: number) =>
  `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>sheet${sheet}-row${r}</t></is></c>` +
  `<c r="B${r}"><v>${r * sheet}</v></c></row>`;

const worksheet = (sheet: number) =>
  `${XML}<worksheet xmlns="${SPREADSHEET}"><sheetData>` +
  ROWS.map((r) => row(sheet, r)).join('') +
  '</sheetData></worksheet>';

const workbook = () =>
  `${XML}<workbook xmlns="${SPREADSHEET}" xmlns:r="${OFFICE}/relationships"><sheets>` +
  SHEETS.map((n) => `<sheet name="Budget${n}" sheetId="${n}" r:id="rId${n}"/>`).join('') +
  '</sheets></workbook>';

const workbookRels = () =>
  `${XML}<Relationships xmlns="${PACKAGE}/relationships">` +
  SHEETS.map((n) =>
    relationship(`rId${n}`, `${OFFICE}/relationships/worksheet`, `worksheets/sheet${n}.xml`),
  ).join('') +
  '</Relationships>';

/** A workbook of seven sheets of sixty rows each, more than a preview should read. */
export const xlsx = () =>
  officePackage({
    main: 'xl/workbook.xml',
    relationship: 'officeDocument',
    types: {
      '/xl/workbook.xml':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      ...Object.fromEntries(
        SHEETS.map((n) => [
          `/xl/worksheets/sheet${n}.xml`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
        ]),
      ),
    },
    parts: {
      'xl/workbook.xml': workbook(),
      'xl/_rels/workbook.xml.rels': workbookRels(),
      ...Object.fromEntries(SHEETS.map((n) => [`xl/worksheets/sheet${n}.xml`, worksheet(n)])),
    },
  });
