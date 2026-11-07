/**
 * Writes every fixture into test/fixtures/files. All content is fictional. The output is committed,
 * so tests need none of this. Run with `node test/fixtures/generate.ts`. HEIC, video and legacy
 * Office fixtures need `sips`, `ffmpeg` and `soffice`, and are skipped without them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOffice } from 'officeparser';
import sharp from 'sharp';
import { encryptedOoxml, mp3, msg, shiftJis } from './build-binary.ts';
import { CLIP_ARGS, EXIF, LOGO_SVG, MAIL_LINES, PAGE_HTML } from './contents.ts';
import { docx, xlsx, zip } from './build-office.ts';
import { filler, hexBytes, IMAGE_PAGE, pdf, textPage } from './build-pdf.ts';

const out = join(import.meta.dirname, 'files');
mkdirSync(out, { recursive: true });
const write = (name: string, data: string | Uint8Array) => writeFileSync(join(out, name), data);

/** A flat image of one colour, to encode as any format. */
const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } });

/** PDFs with text and metadata, with only a scanned image, with a password, and broken. */
async function writePdfs() {
  const pages = [filler('Page one'), filler('Page two'), filler('Page three')].map(textPage);
  const info =
    '<< /Title (Harbor Survey) /Author (Mira Quill) /Producer (FixtureMaker 1.0) ' +
    '/CreationDate (D:20240315093000Z) >>';
  write('report.pdf', pdf(pages, { info }));

  const jpeg = await solid(200, 260, '#dde').jpeg().toBuffer();
  const image = { width: 200, height: 260, jpeg };
  write('scanned.pdf', pdf([IMAGE_PAGE, IMAGE_PAGE, IMAGE_PAGE], { image }));

  // The check value in /U is wrong for an empty password, so a reader must ask for one.
  const encrypt = `<< /Filter /Standard /V 1 /R 2 /O ${hexBytes(32)} /U ${hexBytes(32)} /P -44 >>`;
  const trailer = '/Encrypt $EXTRA 0 R /ID [<00> <00>]';
  write('locked.pdf', pdf([textPage(['Secret'])], { trailer, extraObjects: [encrypt] }));

  write('broken.pdf', '%PDF-1.4\nthis is not really a pdf, only its first line\n');
}

/** OOXML, RTF and HTML, and from the HTML, the formats officeparser can write. */
async function writeOfficeDocuments() {
  write('plan.docx', await docx());
  write('budget.xlsx', await xlsx());
  write('page.html', PAGE_HTML);
  write('note.rtf', '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times;}}\\f0 The ferry bell rings at noon.}');
  const source = await parseOffice(join(out, 'page.html'), { allowRemoteAssets: false, ocr: false });
  for (const format of ['pptx', 'odt', 'ods', 'odp', 'epub'] as const) {
    write(`converted.${format}`, (await source.to(format)).value);
  }
  write('locked.docx', encryptedOoxml());
}

/** Text in a legacy encoding, and the text formats read as they are. */
function writePlainText() {
  const minutes = '港の灯籠祭りの議事録です。\n来週の会議は月曜日に開催します。\n担当者は山田さんです。\n';
  write('notes.sjis.txt', shiftJis(minutes));
  write('table.csv', 'date,item,amount\n2024-01-05,lantern oil,12.50\n2024-01-09,rope,8.00\n');
  write('readme.md', '# Harbor Guide\n\nWhere to moor a small boat.\n');
  write('sample.ts', 'export const pier = "north";\n');
  write('Dockerfile', 'FROM scratch\nCOPY harbor /harbor\n');
  write('logo.svg', LOGO_SVG);
}

/** The same kind of mail as MIME and as an Outlook message. */
function writeMail() {
  write('mail.eml', MAIL_LINES.join('\r\n'));
  write('message.msg', msg());
}

/** Archives, one with a password, an MP3 with tags, and bytes no extractor reads. */
async function writeArchivesAndMedia() {
  const minutes = {
    'minutes/2024-01.txt': 'January',
    'minutes/2024-02.txt': 'February',
    'budget.csv': 'a,b\n',
  };
  write('archive.zip', await zip(minutes));
  write('locked.zip', await zip({ 'secret/plans.txt': 'hidden' }, 'lantern'));
  write('song.mp3', mp3());
  write('noise.bin', Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37) % 256)));
}

/** Images with and without metadata, a screenshot by name, and a truncated JPEG. */
async function writeImages() {
  await solid(320, 200, '#27a').withExif(EXIF).png().toFile(join(out, 'photo-exif.png'));
  await solid(640, 320, '#a72')
    .withExif(EXIF)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toFile(join(out, 'photo.jpg'));
  await sharp({ create: { width: 90, height: 40, channels: 4, background: '#0000' } })
    .png()
    .toFile(join(out, 'tiny-transparent.png'));
  await solid(1440, 900, '#fff').png({ compressionLevel: 9 }).toFile(join(out, 'display.png'));
  await solid(300, 200, '#fff').png().toFile(join(out, 'Screenshot 2024-03-15 at 09.30.00.png'));
  write('truncated.jpg', (await solid(64, 64, '#123').jpeg().toBuffer()).subarray(0, 40));
}

/** Runs an external tool in a temp folder, and only notes it as skipped when it fails. */
function withTool(run: (temp: string) => void) {
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

/** HEIC, MP4 and legacy Office files, from tools a machine may lack. */
function writeWithExternalTools() {
  withTool(() => {
    const heic = ['-s', 'format', 'heic', join(out, 'photo.jpg'), '--out', join(out, 'photo.heic')];
    execFileSync('sips', heic, { stdio: 'ignore' });
  });
  withTool(() => {
    execFileSync('ffmpeg', [...CLIP_ARGS, join(out, 'clip.mp4')], { stdio: 'ignore' });
  });
  withTool((temp) => {
    const profile = `-env:UserInstallation=file://${temp}/profile`;
    for (const [format, input] of [
      ['doc', 'plan.docx'],
      ['xls', 'budget.xlsx'],
    ] as const) {
      const args = [profile, '--headless', '--convert-to', format, '--outdir', out, join(out, input)];
      execFileSync('soffice', args, { stdio: 'ignore', timeout: 120_000 });
    }
  });
}

await writePdfs();
await writeOfficeDocuments();
writePlainText();
writeMail();
await writeArchivesAndMedia();
await writeImages();
writeWithExternalTools();
