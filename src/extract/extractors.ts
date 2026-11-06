/** Sniffing and the extractor table. Parsers load on first use, so a worker starts fast. */
import { openAsBlob } from 'node:fs';
import { exif, image, screenshot } from './images.ts';
import { eml, msg } from './mail.ts';
import { ffmpegFrames, media } from './media.ts';
import { libreoffice, office } from './office.ts';
import { pdf, pdfRender } from './pdf.ts';
import { type Extractor, put, readRange, setText } from './source.ts';

const MIB = 2 ** 20;
const SNIFF_BYTES = 4100;
const TEXT_HEAD = 64 * 1024;
const TEXT_TAIL = 16 * 1024;
const LEGACY_CJK_CHARSET = /^(Shift_JIS|EUC-|GB18030|Big5|ISO-2022)/;
const TEXT_MIME = /^(text\/|image\/svg\+xml$|message\/rfc822$)/;

/** `isbinaryfile` calls Shift_JIS binary, so a legacy CJK charset that decodes cleanly counts as text. */
async function looksLikeText(bytes: Buffer): Promise<boolean> {
  const { isBinaryFile } = await import('isbinaryfile');
  if (!(await isBinaryFile(bytes))) return true;
  if (bytes.includes(0)) return false;
  const { detect } = await import('chardet');
  const charset = detect(bytes);
  if (!charset || !LEGACY_CJK_CHARSET.test(charset)) return false;
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
  if (!(await looksLikeText(await readRange(path, SNIFF_BYTES)))) {
    return byName ?? 'application/octet-stream';
  }
  return byName && TEXT_MIME.test(byName) ? byName : 'text/plain';
}

async function decoderFor(bytes: Buffer): Promise<TextDecoder> {
  const { detect } = await import('chardet');
  try {
    return new TextDecoder(detect(bytes) ?? 'utf-8');
  } catch {
    return new TextDecoder(); // a charset the platform cannot decode: UTF-8 replaces what it cannot read
  }
}

const text: Extractor = async (file, state) => {
  if (state.text) return;
  const whole = file.size <= TEXT_HEAD + TEXT_TAIL;
  const head = await readRange(file.path, whole ? file.size : TEXT_HEAD);
  if (!(await looksLikeText(head))) return;
  const decoder = await decoderFor(head);
  if (whole) return setText(state, decoder.decode(head));
  const tail = await readRange(file.path, TEXT_TAIL, file.size - TEXT_TAIL);
  setText(state, `${decoder.decode(head)}\n[...]\n${decoder.decode(tail)}`);
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
  libreoffice: capped('max_office_mb', libreoffice),
};
