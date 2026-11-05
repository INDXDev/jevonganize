/**
 * Writes every fixture into test/fixtures/files. All content is fictional. The output is committed,
 * so tests need none of this. Run with `node test/fixtures/generate.ts`. HEIC, video and legacy
 * Office fixtures need `sips`, `ffmpeg` and `soffice`, and are skipped without them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { burn } from '@kenjiuno/msgreader/lib/Burner.js';
import { TypeEnum } from '@kenjiuno/msgreader/lib/Reader.js';
import { parseOffice } from 'officeparser';
import sharp from 'sharp';

const out = join(import.meta.dirname, 'files');
mkdirSync(out, { recursive: true });
const write = (name: string, data: string | Uint8Array) => writeFileSync(join(out, name), data);

/** Builds a PDF. Each page is a content stream, plus the objects it refers to by name. */
function pdf(
  pages: string[],
  options: { info?: string; xobject?: { width: number; height: number; jpeg: Buffer } } = {},
  trailerExtra = '',
  objectsExtra: string[] = [],
): Buffer {
  const objects: (string | Buffer)[] = [];
  const add = (body: string | Buffer) => objects.push(body) + 0;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let image = '';
  if (options.xobject) {
    const { width, height, jpeg } = options.xobject;
    const n = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB ` +
            `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        ),
        jpeg,
        Buffer.from('\nendstream'),
      ]),
    );
    image = `/XObject << /Im0 ${n} 0 R >>`;
  }
  const kids = pages.map((content) => {
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    return add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${stream} 0 R ` +
        `/Resources << /Font << /F1 3 0 R >> ${image} >> >>`,
    );
  });
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`;
  const info = options.info ? add(options.info) : 0;
  const extra = objectsExtra.map(add);

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let at = chunks[0]!.length;
  const offsets = objects.map((body, i) => {
    const offset = at;
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(body), Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    at += chunk.length;
    return offset;
  });
  const xref = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  const refs = (info ? `/Info ${info} 0 R ` : '') + trailerExtra.replace('$EXTRA', String(extra[0]));
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n` +
        `<< /Size ${objects.length + 1} /Root 1 0 R ${refs} >>\nstartxref\n${at}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

const textPage = (lines: string[]) =>
  `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET`;
const filler = (label: string) =>
  Array.from({ length: 8 }, (_, i) => `${label} line ${i}: the Harbor Lantern Society met to review minutes.`);

async function zip(entries: Record<string, string | Uint8Array>, password?: string): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    password,
    zipCrypto: Boolean(password),
    useWebWorkers: false,
  });
  for (const [name, body] of Object.entries(entries)) {
    await writer.add(name, typeof body === 'string' ? new TextReader(body) : new Uint8ArrayReader(body));
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Lantern Festival Plan</dc:title><dc:creator>Mira Quill</dc:creator><cp:lastModifiedBy>Oren Vale</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2024-03-15T09:30:00Z</dcterms:created></cp:coreProperties>`;
const app = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Harbor Lantern Society</Company></Properties>`;
const rels = (main: string, type: string) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const contentTypes = (overrides: Record<string, string>) =>
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
    {
      ...overrides,
      '/docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml',
      '/docProps/app.xml': 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    },
  )
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join('')}</Types>`;

const docx = () =>
  zip({
    '[Content_Types].xml': contentTypes({
      '/word/document.xml':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }),
    '_rels/.rels': rels('word/document.xml', 'officeDocument'),
    'docProps/core.xml': core,
    'docProps/app.xml': app,
    'word/document.xml': `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>The lantern parade begins at the old pier at dusk.</w:t></w:r></w:p><w:p><w:r><w:t>Volunteers meet at the ferry gate.</w:t></w:r></w:p></w:body></w:document>`,
  });

function xlsx() {
  const sheets = Array.from({ length: 7 }, (_, i) => i + 1);
  const rows = Array.from({ length: 60 }, (_, r) => r + 1);
  const sheet = (n: number) =>
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (r) =>
          `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>sheet${n}-row${r}</t></is></c><c r="B${r}"><v>${r * n}</v></c></row>`,
      )
      .join('')}</sheetData></worksheet>`;
  return zip({
    '[Content_Types].xml': contentTypes({
      '/xl/workbook.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      ...Object.fromEntries(
        sheets.map((n) => [
          `/xl/worksheets/sheet${n}.xml`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
        ]),
      ),
    }),
    '_rels/.rels': rels('xl/workbook.xml', 'officeDocument'),
    'docProps/core.xml': core,
    'docProps/app.xml': app,
    'xl/workbook.xml': `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((n) => `<sheet name="Budget${n}" sheetId="${n}" r:id="rId${n}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (n) =>
          `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
      )
      .join('')}</Relationships>`,
    ...Object.fromEntries(sheets.map((n) => [`xl/worksheets/sheet${n}.xml`, sheet(n)])),
  });
}

/** Reverses the decoder, because the platform has no Shift_JIS encoder. */
function shiftJis(text: string): Buffer {
  const decoder = new TextDecoder('shift_jis');
  const table = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      table.set(decoder.decode(new Uint8Array([lead, trail])), [lead, trail]);
    }
  }
  const chars = Array.from(text);
  return Buffer.from(
    chars.flatMap((char) => (char.charCodeAt(0) < 0x80 ? [char.charCodeAt(0)] : table.get(char)!)),
  );
}

function id3Frame(id: string, text: string): Buffer {
  const body = Buffer.from(`\0${text}`, 'latin1');
  const head = Buffer.alloc(10);
  head.write(id, 'latin1');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

function mp3(): Buffer {
  const tags = Buffer.concat([
    id3Frame('TIT2', 'Harbor Lights'),
    id3Frame('TPE1', 'The Pier Quartet'),
    id3Frame('TALB', 'Night Ferry'),
    id3Frame('TCON', 'Jazz'),
    id3Frame('TYER', '2023'),
  ]);
  const size = Buffer.from([3, 2, 1, 0].map((shift) => (tags.length >> (shift * 7)) & 0x7f));
  const header = Buffer.concat([Buffer.from('ID3\x03\0\0', 'latin1'), size]);
  const audio = Buffer.alloc(417); // one silent MPEG-1 layer III frame: 128 kbit/s, 44.1 kHz
  audio.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat([header, tags, ...Array.from({ length: 40 }, () => audio)]);
}

/** A compound file with the streams of an Outlook message, or of an encrypted OOXML package. */
function cfb(streams: Record<string, Uint8Array>, storages: Record<string, Record<string, Uint8Array>> = {}) {
  const entries: Parameters<typeof burn>[0] = [{ name: 'Root Entry', type: TypeEnum.ROOT, length: 0, children: [] }];
  const document = (name: string, data: Uint8Array, parent: number[]) => {
    parent.push(entries.length);
    entries.push({ name, type: TypeEnum.DOCUMENT, length: data.length, binaryProvider: () => data });
  };
  for (const [name, data] of Object.entries(streams)) document(name, data, entries[0]!.children!);
  for (const [name, children] of Object.entries(storages)) {
    const list: number[] = [];
    entries[0]!.children!.push(entries.length);
    entries.push({ name, type: TypeEnum.DIRECTORY, length: 0, children: list });
    for (const [child, data] of Object.entries(children)) document(child, data, list);
  }
  return burn(entries);
}

// A copy: `burn` reads the backing store, and a small Buffer shares Node's pool.
const utf16 = (text: string) => Uint8Array.from(Buffer.from(text, 'utf16le'));

function msg() {
  return cfb(
    {
      '__properties_version1.0': new Uint8Array(32),
      '__substg1.0_0037001F': utf16('Ferry timetable change'),
      '__substg1.0_1000001F': utf16('The evening ferry now leaves at seven.'),
      '__substg1.0_0C1A001F': utf16('Mira Quill'),
      '__substg1.0_0C1F001F': utf16('mira@example.test'),
    },
    {
      '__recip_version1.0_#00000000': {
        '__properties_version1.0': new Uint8Array(8),
        '__substg1.0_3001001F': utf16('Oren Vale'),
        '__substg1.0_39FE001F': utf16('oren@example.test'),
      },
    },
  );
}

const jpegPixels = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } });
const hex = (n: number) => '<' + 'ab'.repeat(n) + '>';

write(
  'report.pdf',
  pdf([textPage(filler('Page one')), textPage(filler('Page two')), textPage(filler('Page three'))], {
    info: '<< /Title (Harbor Survey) /Author (Mira Quill) /Producer (FixtureMaker 1.0) /CreationDate (D:20240315093000Z) >>',
  }),
);
const scan = await jpegPixels(200, 260, '#dde').jpeg().toBuffer();
write(
  'scanned.pdf',
  pdf(['q 612 0 0 792 0 0 cm /Im0 Do Q', 'q 612 0 0 792 0 0 cm /Im0 Do Q', 'q 612 0 0 792 0 0 cm /Im0 Do Q'], {
    xobject: { width: 200, height: 260, jpeg: scan },
  }),
);
// The check value in /U is wrong for an empty password, so a reader must ask for one.
write(
  'locked.pdf',
  pdf([textPage(['Secret'])], {}, '/Encrypt $EXTRA 0 R /ID [<00> <00>]', [
    `<< /Filter /Standard /V 1 /R 2 /O ${hex(32)} /U ${hex(32)} /P -44 >>`,
  ]),
);
write('broken.pdf', '%PDF-1.4\nthis is not really a pdf, only its first line\n');

write('plan.docx', await docx());
write('budget.xlsx', await xlsx());
write(
  'page.html',
  '<!doctype html><html><head><title>Pier Notes</title></head><body><h1>Pier Notes</h1><p>The tide table is posted weekly.</p></body></html>',
);
write('note.rtf', '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times;}}\\f0 The ferry bell rings at noon.}');
const source = await parseOffice(join(out, 'page.html'), { allowRemoteAssets: false, ocr: false });
for (const format of ['pptx', 'odt', 'ods', 'odp', 'epub'] as const) {
  write(`converted.${format}`, (await source.to(format)).value);
}

write('notes.sjis.txt', shiftJis('港の灯籠祭りの議事録です。\n来週の会議は月曜日に開催します。\n担当者は山田さんです。\n'));
write('table.csv', 'date,item,amount\n2024-01-05,lantern oil,12.50\n2024-01-09,rope,8.00\n');
write('readme.md', '# Harbor Guide\n\nWhere to moor a small boat.\n');
write('sample.ts', 'export const pier = "north";\n');
write('Dockerfile', 'FROM scratch\nCOPY harbor /harbor\n');
write(
  'logo.svg',
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><title>Lantern Logo</title><rect width="120" height="60" fill="#c33"/></svg>',
);
write(
  'mail.eml',
  [
    'From: Mira Quill <mira@example.test>',
    'To: Oren Vale <oren@example.test>, Tess Rowe <tess@example.test>',
    'Subject: =?UTF-8?B?5riv44Gu5LqI5a6a?=',
    'Date: Fri, 15 Mar 2024 09:30:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'The parade route is attached.',
    '--b',
    'Content-Type: application/pdf; name="route.pdf"',
    'Content-Disposition: attachment; filename="route.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQK',
    '--b--',
    '',
  ].join('\r\n'),
);
write('message.msg', msg());
write(
  'locked.docx',
  cfb({ EncryptionInfo: new Uint8Array(64), EncryptedPackage: new Uint8Array(64) }),
);

write(
  'archive.zip',
  await zip({ 'minutes/2024-01.txt': 'January', 'minutes/2024-02.txt': 'February', 'budget.csv': 'a,b\n' }),
);
write('locked.zip', await zip({ 'secret/plans.txt': 'hidden' }, 'lantern'));
write('song.mp3', mp3());
write('noise.bin', Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37) % 256)));

const exif = {
  IFD0: { Make: 'Fictional', Model: 'Harbor 1', Artist: 'Mira Quill' },
  IFD2: { DateTimeOriginal: '2023:07:04 18:30:00' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 40/1 0/1' },
};
await jpegPixels(320, 200, '#27a').withExif(exif).png().toFile(join(out, 'photo-exif.png'));
await sharp({ create: { width: 640, height: 320, channels: 3, background: '#a72' } })
  .withExif(exif)
  .withMetadata({ orientation: 6 })
  .jpeg()
  .toFile(join(out, 'photo.jpg'));
await sharp({ create: { width: 90, height: 40, channels: 4, background: '#0000' } })
  .png()
  .toFile(join(out, 'tiny-transparent.png'));
await jpegPixels(1440, 900, '#fff').png({ compressionLevel: 9 }).toFile(join(out, 'display.png'));
await jpegPixels(300, 200, '#fff').png().toFile(join(out, 'Screenshot 2024-03-15 at 09.30.00.png'));
write('truncated.jpg', (await jpegPixels(64, 64, '#123').jpeg().toBuffer()).subarray(0, 40));

function tool(run: (temp: string) => void) {
  const temp = join(tmpdir(), `jev-fixture-${process.pid}`);
  mkdirSync(temp, { recursive: true });
  try {
    run(temp);
  } catch (error) {
    process.stderr.write(`skipped: ${(error as Error).message.split('\n')[0]}\n`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

tool(() => {
  execFileSync('sips', ['-s', 'format', 'heic', join(out, 'photo.jpg'), '--out', join(out, 'photo.heic')], {
    stdio: 'ignore',
  });
});
tool(() => {
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=2', '-metadata', 'title=Pier Clip',
      '-pix_fmt', 'yuv420p', join(out, 'clip.mp4')],
    { stdio: 'ignore' },
  );
});
tool((temp) => {
  const profile = `-env:UserInstallation=file://${temp}/profile`;
  for (const [format, input] of [['doc', 'plan.docx'], ['xls', 'budget.xlsx']]) {
    execFileSync('soffice', [profile, '--headless', '--convert-to', format!, '--outdir', out, join(out, input!)], {
      stdio: 'ignore',
      timeout: 120_000,
    });
  }
});
