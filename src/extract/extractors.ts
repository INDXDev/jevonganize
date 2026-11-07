/** The extractor table, plus the text and zip extractors. Parsers load on first use, for speed. */
import { openAsBlob } from 'node:fs';
import { exif, image, screenshot } from './images.ts';
import { eml, msg } from './mail.ts';
import { ffmpegFrames, media } from './media.ts';
import { libreoffice } from './libreoffice.ts';
import { office } from './office.ts';
import { pdf, pdfRender } from './pdf.ts';
import { looksLikeText } from './sniff.ts';
import { type Extractor, put, readRange, setText } from './source.ts';

const MIB = 2 ** 20;
const TEXT_HEAD_BYTES = 64 * 1024;
const TEXT_TAIL_BYTES = 16 * 1024;

/** A decoder for the charset the bytes look like, else UTF-8. */
async function decoderFor(bytes: Buffer): Promise<TextDecoder> {
  const { detect } = await import('chardet');
  const charset = detect(bytes) ?? 'utf-8';
  try {
    return new TextDecoder(charset);
  } catch {
    // A charset the platform cannot decode: UTF-8 replaces what it cannot read.
    return new TextDecoder();
  }
}

/** Reads a text file whole, or its head and tail when it is long. */
const plainText: Extractor = async (file, state) => {
  if (state.text) return;
  const fitsWhole = file.size <= TEXT_HEAD_BYTES + TEXT_TAIL_BYTES;
  const head = await readRange(file.path, fitsWhole ? file.size : TEXT_HEAD_BYTES);
  if (!(await looksLikeText(head))) return;
  const decoder = await decoderFor(head);
  if (fitsWhole) return setText(state, decoder.decode(head));
  const tail = await readRange(file.path, TEXT_TAIL_BYTES, file.size - TEXT_TAIL_BYTES);
  setText(state, `${decoder.decode(head)}\n[...]\n${decoder.decode(tail)}`);
};

/** Lists an archive's entry names. Nothing in it is unpacked or read. */
const zipEntryNames: Extractor = async (file, state, budget) => {
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const archive = new BlobReader(await openAsBlob(file.path));
  const reader = new ZipReader(archive, { useWebWorkers: false });
  const names: string[] = [];
  let entryCount = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      entryCount++;
      if (names.length < budget.zip_entries) names.push(entry.filename);
      if (entry.encrypted) put(state, 'encrypted', true);
    }
  } finally {
    await reader.close();
  }
  put(state, 'entries', entryCount);
  setText(state, names.join('\n'));
};

/** Skips a parser that reads the whole file when the file is over `limit`. */
const skipWhenLarger =
  (limit: 'max_parse_mb' | 'max_office_mb', parse: Extractor): Extractor =>
  async (file, state, budget) => {
    const isTooLarge = file.size > budget[limit] * MIB;
    if (isTooLarge) {
      state.warnings.push('too large to parse');
      return;
    }
    await parse(file, state, budget);
  };

/** Every extractor, by the id used in `[[pipeline]]`. See docs/pipeline.md. */
export const extractors: Record<string, Extractor> = {
  pdf: skipWhenLarger('max_parse_mb', pdf),
  'pdf-render': skipWhenLarger('max_parse_mb', pdfRender),
  office: skipWhenLarger('max_office_mb', office),
  text: plainText,
  image: skipWhenLarger('max_parse_mb', image),
  heic: skipWhenLarger('max_parse_mb', image),
  exif,
  screenshot,
  media,
  eml: skipWhenLarger('max_parse_mb', eml),
  msg: skipWhenLarger('max_parse_mb', msg),
  zip: zipEntryNames,
  'ffmpeg-frames': ffmpegFrames,
  libreoffice: skipWhenLarger('max_office_mb', libreoffice),
};
