/** Sniffing and the extractor table. Parsers load on first use, so a worker starts fast. */
import { execFile } from 'node:child_process';
import { accessSync, constants, openAsBlob } from 'node:fs';
import { mkdtemp, open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Sharp } from 'sharp';
import type { Budget } from '../core/config.ts';
import { ifExists } from '../core/config.ts';
import { isScreenCapture } from '../core/tags.ts';
import type { FileState } from '../types.ts';

/** The file being read. `deadline` (epoch ms) is when the pool will terminate this task. */
export interface SourceFile {
  path: string;
  name: string;
  size: number;
  mime: string;
  deadline: number;
}

export type Extractor = (file: SourceFile, state: FileState, budget: Budget) => Promise<void>;

const MIB = 2 ** 20;
const MIN_EDGE = 280; // Jev rejects smaller images
const MAX_PDF_IMAGE_PIXELS = 2 ** 26;
const TEXT_HEAD = 64 * 1024;
const TEXT_TAIL = 16 * 1024;
const EXIF_BYTES = MIB; // shortcut: EXIF placed later than this is missed, raise it if real files need it
const TOOL_GRACE_MS = 250; // a child must die before the pool terminates the worker that could kill it
/** `qlmanage` hangs, rather than exits, on a file it has no generator for. A real preview took 0.2 s. */
// shortcut: every unknown binary costs this much on macOS, lower it if scans of such files drag
const QUICKLOOK_MS = 3000;
const SCREENSHOT_NAME =
  /Screenshot|Screen Shot|スクリーンショット|Bildschirmfoto|Capture d['’]écran|Captura de pantalla/i;
const DISPLAY_SIZES = new Set(
  '1280x720 1280x800 1366x768 1440x900 1536x864 1600x900 1680x1050 1920x1080 1920x1200 2048x1152 2560x1440 2560x1600 2880x1800 3024x1964 3456x2234 3840x2160 5120x2880'.split(
    ' ',
  ),
);

const put = (
  state: FileState,
  key: string,
  value: string | number | boolean | null | undefined,
) => {
  if (value !== undefined && value !== null && value !== '' && !Number.isNaN(value)) {
    state.metadata[key] ??= value;
  }
};

const setText = (state: FileState, text: string) => {
  state.text ||= text.trim();
};

function iso(value: string | number | Date | null | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function readRange(path: string, length: number, position = 0): Promise<Buffer> {
  const handle = await open(path);
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(length), 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** `isbinaryfile` calls Shift_JIS binary, so a legacy CJK charset that decodes cleanly counts as text. */
async function looksLikeText(bytes: Buffer): Promise<boolean> {
  const { isBinaryFile } = await import('isbinaryfile');
  if (!(await isBinaryFile(bytes))) return true;
  if (bytes.includes(0)) return false;
  const { detect } = await import('chardet');
  const charset = detect(bytes);
  if (!charset || !/^(Shift_JIS|EUC-|GB18030|Big5|ISO-2022)/.test(charset)) return false;
  try {
    new TextDecoder(charset, { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** The file's MIME type. See "Sniffing" in docs/pipeline.md. */
export async function sniff(path: string): Promise<string> {
  const { fileTypeFromFile } = await import('file-type');
  const found = (await fileTypeFromFile(path))?.mime;
  if (found && found !== 'application/x-cfb') return found;
  const { default: mime } = await import('mime');
  const byName = mime.getType(path);
  if (!(await looksLikeText(await readRange(path, 4100)))) {
    return byName ?? 'application/octet-stream';
  }
  return byName && /^(text\/|image\/svg\+xml$|message\/rfc822$)/.test(byName)
    ? byName
    : 'text/plain';
}

/** The absolute path of a program on PATH. */
function findTool(name: string): string | undefined {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, file);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not in this directory
    }
  }
  return undefined;
}

/** Which optional programs are on PATH, for `doctor`. */
export const optionalTools = () =>
  Object.fromEntries(
    ['soffice', 'ffmpeg', 'qlmanage'].map((name) => [name, Boolean(findTool(name))]),
  );

/** No shell. SIGKILL, because a hung tool may ignore anything politer. */
// shortcut: kills the tool, not any process it forked, use a process group if `soffice` ever leaves one
const runTool = (tool: string, args: string[], file: SourceFile, maxMs = Infinity) =>
  promisify(execFile)(tool, args, {
    timeout: Math.max(1, Math.min(maxMs, file.deadline - Date.now() - TOOL_GRACE_MS)),
    killSignal: 'SIGKILL',
  });

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'jevonganize-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Decodes a picture. SVG goes in as bytes, so that it has no base path to reach sibling files. */
export async function picture(path: string, mime: string): Promise<Sharp> {
  const { default: sharp } = await import('sharp');
  if (mime === 'image/svg+xml') return sharp(await readFile(path));
  if (!mime.startsWith('image/hei')) return sharp(path);
  // @ts-expect-error heic-decode ships no types
  const { default: decode } = await import('heic-decode');
  const { width, height, data } = (await decode({ buffer: await readFile(path) })) as {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };
  return sharp(Buffer.from(data), { raw: { width, height, channels: 4 } });
}

/** Adds one image, normalized as described under "FileState" in docs/pipeline.md. */
async function addImage(state: FileState, budget: Budget, image: Sharp, source: string) {
  if (state.images.length >= budget.images) return;
  const { default: sharp } = await import('sharp');
  const { data, info } = await image
    .autoOrient()
    .resize({
      width: budget.image_edge,
      height: budget.image_edge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const padX = Math.max(0, MIN_EDGE - info.width);
  const padY = Math.max(0, MIN_EDGE - info.height);
  const jpeg = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .extend({
      left: padX >> 1,
      right: padX - (padX >> 1),
      top: padY >> 1,
      bottom: padY - (padY >> 1),
      background: '#ffffff',
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  state.images.push({ data: jpeg, mediaType: 'image/jpeg', source });
}

/** Opens a PDF for reading. The caller destroys it. */
export async function openPdf(path: string) {
  const { getDocumentProxy } = await import('unpdf');
  return getDocumentProxy(new Uint8Array(await readFile(path)), {
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
  });
}

type Pdf = Awaited<ReturnType<typeof openPdf>>;

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

const pdf: Extractor = async (file, state, budget) => {
  const { getMeta } = await import('unpdf');
  let doc: Pdf;
  try {
    doc = await openPdf(file.path);
  } catch (error) {
    if ((error as Error).name !== 'PasswordException') throw error;
    return passwordProtected(state);
  }
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

function passwordProtected(state: FileState) {
  put(state, 'encrypted', true);
  state.warnings.push('password protected');
}

const pdfRender: Extractor = async (file, state, budget) => {
  if (state.metadata.pages === undefined) return; // `pdf` could not open it, and has said why
  const { default: sharp } = await import('sharp');
  const doc = await openPdf(file.path);
  try {
    const texts = await pageTexts(doc, budget.pdf_pages);
    const average = texts.join('').length / texts.length;
    if (!(average < budget.thin_text_chars)) return;
    const pages = texts.map((text, index) => ({ text, number: index + 1 }));
    const blank = pages.filter((page) => !page.text);
    for (const { number } of (blank.length ? blank : pages).slice(0, budget.render_pages)) {
      const png = await renderPage(doc, number, budget.image_edge);
      await addImage(state, budget, sharp(png), `page-${number}`);
    }
  } finally {
    await doc.loadingTask.destroy();
  }
};

const office: Extractor = async (file, state, budget) => {
  if (file.mime === 'application/pdf') throw new Error('PDF must not reach officeparser');
  const { parseOffice } = await import('officeparser');
  let ast;
  try {
    ast = await parseOffice(file.path, {
      ocr: false,
      allowRemoteAssets: false,
      extractAttachments: false,
    });
  } catch (error) {
    const code = (error as { officeIssue?: { code?: string } }).officeIssue?.code;
    if (!code?.startsWith('PASSWORD_')) throw error;
    return passwordProtected(state);
  }
  // shortcut: caps apply after parsing, so a huge sheet is slow, stream it if that starts to matter
  if (ast.content.some((node) => node.type === 'sheet')) {
    ast.content = ast.content
      .filter((node) => node.type === 'sheet')
      .slice(0, budget.sheets)
      .map((sheet) => ({ ...sheet, children: sheet.children?.slice(0, budget.sheet_rows) }));
  }
  setText(state, (await ast.to('text')).value);
  const { title, author, lastModifiedBy, created, nativeProperties } = ast.metadata;
  put(state, 'title', title);
  put(state, 'author', author);
  put(state, 'last_author', lastModifiedBy);
  put(state, 'company', nativeProperties?.Company);
  put(state, 'created', iso(created));
};

const text: Extractor = async (file, state) => {
  if (state.text) return;
  const whole = file.size <= TEXT_HEAD + TEXT_TAIL;
  const head = await readRange(file.path, whole ? file.size : TEXT_HEAD);
  if (!(await looksLikeText(head))) return;
  const { detect } = await import('chardet');
  let decoder = new TextDecoder();
  try {
    decoder = new TextDecoder(detect(head) ?? 'utf-8');
  } catch {
    // a charset the platform cannot decode: UTF-8 replaces what it cannot read
  }
  if (whole) return setText(state, decoder.decode(head));
  const tail = await readRange(file.path, TEXT_TAIL, file.size - TEXT_TAIL);
  setText(state, `${decoder.decode(head)}\n[...]\n${decoder.decode(tail)}`);
};

const image: Extractor = async (file, state, budget) => {
  const source = await picture(file.path, file.mime);
  const { width, height, autoOrient } = await source.metadata();
  put(state, 'width', autoOrient?.width ?? width);
  put(state, 'height', autoOrient?.height ?? height);
  if (!state.images.length) await addImage(state, budget, source, 'file');
};

const exif: Extractor = async (file, state) => {
  const { default: ExifReader } = await import('exifreader');
  let tags;
  try {
    tags = ExifReader.load(await readRange(file.path, EXIF_BYTES)); // a Buffer: strings are fetched as URLs
  } catch (error) {
    if ((error as Error).name === 'MetadataMissingError') return;
    throw error;
  }
  const camera = [tags.Make?.description, tags.Model?.description].filter(Boolean).join(' ');
  const taken = /^(\d{4}):(\d\d):(\d\d) (\d\d:\d\d:\d\d)/.exec(
    tags.DateTimeOriginal?.description ?? '',
  );
  put(state, 'author', tags.Artist?.description);
  // EXIF has no zone. Reading it as UTC keeps the state the same on every machine.
  if (taken) put(state, 'created', iso(`${taken[1]}-${taken[2]}-${taken[3]}T${taken[4]}Z`));
  put(state, 'camera', camera);
};

const screenshot: Extractor = async (file, state) => {
  if (isScreenCapture(file.path) || SCREENSHOT_NAME.test(file.name.normalize('NFC'))) {
    put(state, 'screenshot', true);
  } else if (
    file.mime === 'image/png' &&
    !state.metadata.camera &&
    DISPLAY_SIZES.has(`${state.metadata.width}x${state.metadata.height}`)
  ) {
    put(state, 'screenshot_hint', true);
  }
};

const media: Extractor = async (file, state) => {
  const { parseFile } = await import('music-metadata');
  const { common, format } = await parseFile(file.path, { skipCovers: true });
  put(state, 'title', common.title);
  put(state, 'artist', common.artist);
  put(state, 'album', common.album);
  put(state, 'genre', common.genre?.join(', '));
  put(state, 'duration', format.duration);
  put(state, 'codec', format.codec);
  put(state, 'created', iso(common.date));
};

interface Mail {
  subject?: string;
  from?: string;
  to?: string[];
  date?: string | number;
  body?: string;
  attachments?: (string | null | undefined)[];
}

function fillMail(state: FileState, mail: Mail) {
  put(state, 'subject', mail.subject);
  put(state, 'from', mail.from);
  put(state, 'to', mail.to?.join(', '));
  put(state, 'created', iso(mail.date));
  put(state, 'attachments', mail.attachments?.filter(Boolean).join(', '));
  setText(state, [mail.subject, mail.body].filter(Boolean).join('\n\n'));
}

const person = (name?: string, address?: string) =>
  name && address ? `${name} <${address}>` : (name ?? address);

// shortcut: drops tags with no entity decoding, use officeparser's HTML route if mail text reads badly
const htmlToText = (html: string) =>
  html.replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');

const eml: Extractor = async (file, state) => {
  const { default: PostalMime } = await import('postal-mime');
  const mail = await PostalMime.parse(await readFile(file.path));
  fillMail(state, {
    subject: mail.subject,
    from: person(mail.from?.name, mail.from?.address),
    to: mail.to?.map(({ name, address }) => person(name, address) ?? ''),
    date: mail.date,
    body: mail.text ?? htmlToText(mail.html ?? ''),
    attachments: mail.attachments.map(({ filename }) => filename),
  });
};

const msg: Extractor = async (file, state) => {
  const { default: module } = await import('@kenjiuno/msgreader');
  const bytes = await readFile(file.path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const mail = new module.default(view).getFileData();
  if (mail.error) throw new Error(mail.error);
  fillMail(state, {
    subject: mail.subject,
    from: person(mail.senderName, mail.senderSmtpAddress ?? mail.senderEmail),
    to: mail.recipients?.map(
      ({ name, smtpAddress, email }) => person(name, smtpAddress ?? email) ?? '',
    ),
    date: mail.messageDeliveryTime ?? mail.clientSubmitTime,
    body: mail.body,
    attachments: mail.attachments?.map(({ fileName, name }) => fileName ?? name),
  });
};

const zip: Extractor = async (file, state, budget) => {
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(await openAsBlob(file.path)), {
    useWebWorkers: false,
  });
  const names: string[] = [];
  let entries = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      entries++;
      if (names.length < budget.zip_entries) names.push(entry.filename);
      if (entry.encrypted) put(state, 'encrypted', true);
    }
  } finally {
    await reader.close();
  }
  put(state, 'entries', entries);
  setText(state, names.join('\n'));
};

const ffmpegFrames: Extractor = async (file, state, budget) => {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg || state.images.length) return;
  const { default: sharp } = await import('sharp');
  const duration = Number(state.metadata.duration) || 0;
  const count = duration ? budget.images : Math.min(1, budget.images);
  await withTempDir(async (dir) => {
    for (let index = 0; index < count; index++) {
      const frame = join(dir, `${index}.png`);
      const seek = String((duration * (index + 0.5)) / count);
      // Only local reads: a crafted container can name playlists and URLs for ffmpeg to fetch.
      await runTool(
        ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-protocol_whitelist',
          'file',
          '-ss',
          seek,
          '-i',
          file.path,
        ].concat(['-frames:v', '1', frame]),
        file,
      );
      const bytes = await ifExists(readFile(frame)); // a seek past the last frame writes nothing
      if (bytes) await addImage(state, budget, sharp(bytes), `frame-${index + 1}`);
    }
  });
};

const quicklook: Extractor = async (file, state, budget) => {
  const qlmanage = findTool('qlmanage');
  if (!qlmanage || state.text || state.images.length) return;
  const { default: sharp } = await import('sharp');
  await withTempDir(async (dir) => {
    const args = ['-t', '-s', String(budget.image_edge), '-o', dir, file.path];
    await runTool(qlmanage, args, file, QUICKLOOK_MS).catch(() => undefined); // no preview is no fault
    const [made] = await readdir(dir);
    if (made) await addImage(state, budget, sharp(join(dir, made)), 'quicklook');
  });
};

const libreoffice: Extractor = async (file, state, budget) => {
  const soffice = findTool('soffice');
  if (!soffice || state.text) return;
  await withTempDir(async (dir) => {
    // shortcut: a new profile per file costs seconds, but two runs cannot share one, pool them if slow
    const profile = `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`;
    await runTool(
      soffice,
      [profile, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, file.path],
      file,
    );
    const made = (await readdir(dir)).find((name) => name.endsWith('.pdf'));
    if (!made) throw new Error('soffice wrote no PDF');
    const path = join(dir, made);
    const converted = { ...file, path, size: (await stat(path)).size };
    await pdf(converted, state, budget);
    await pdfRender(converted, state, budget);
  });
};

/** Skips a parser that reads the whole file when the file is over `limit`. */
const capped =
  (limit: 'max_parse_mb' | 'max_office_mb', run: Extractor): Extractor =>
  async (file, state, budget) => {
    if (file.size > budget[limit] * MIB) state.warnings.push('too large to parse');
    else await run(file, state, budget);
  };

/** Every extractor, by the id used in `[[pipeline]]`. See docs/pipeline.md. */
export const extractors: Record<string, Extractor> = {
  pdf: capped('max_parse_mb', pdf),
  'pdf-render': capped('max_parse_mb', pdfRender),
  office: capped('max_office_mb', office),
  text,
  image: capped('max_parse_mb', image),
  heic: capped('max_parse_mb', image),
  exif,
  screenshot,
  media,
  eml: capped('max_parse_mb', eml),
  msg: capped('max_parse_mb', msg),
  zip,
  'ffmpeg-frames': ffmpegFrames,
  quicklook,
  libreoffice: capped('max_office_mb', libreoffice),
};
