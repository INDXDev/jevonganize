/** Picture formats: decoding, the normalized image a model sees, EXIF and screenshot detection. */
import { readFile } from 'node:fs/promises';
import type { OutputInfo, Sharp } from 'sharp';
import type { Budget } from '../core/config.ts';
import { isScreenCapture } from '../core/tags.ts';
import type { FileState } from '../types.ts';
import { type Extractor, iso, put, readRange, type SourceFile } from './source.ts';

const MIN_EDGE = 280; // Jev rejects smaller images
const EXIF_BYTES = 2 ** 20; // shortcut: EXIF placed later than this is missed, raise it if real files need it
const SCREENSHOT_NAME =
  /Screenshot|Screen Shot|スクリーンショット|Bildschirmfoto|Capture d['’]écran|Captura de pantalla/i;
const DISPLAY_SIZES = new Set(
  '1280x720 1280x800 1366x768 1440x900 1536x864 1600x900 1680x1050 1920x1080 1920x1200 2048x1152 2560x1440 2560x1600 2880x1800 3024x1964 3456x2234 3840x2160 5120x2880'.split(
    ' ',
  ),
);

/** Decodes a picture. SVG goes in as bytes, so that it has no base path to reach sibling files. */
export async function picture(path: string, mime: string): Promise<Sharp> {
  const { default: sharp } = await import('sharp');
  sharp.cache(false); // its cache keeps a decoded file open, which on Windows locks the user's file
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

/** Raw sRGB pixels on white, upright, and no longer than `edge` on either side. */
const fitWithin = (image: Sharp, edge: number) =>
  image
    .autoOrient()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

/** Encodes raw pixels as a JPEG, centred on white up to the minimum edge. */
async function padToJpeg(data: Buffer, info: OutputInfo): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const padX = Math.max(0, MIN_EDGE - info.width);
  const padY = Math.max(0, MIN_EDGE - info.height);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extend({
      left: padX >> 1,
      right: padX - (padX >> 1),
      top: padY >> 1,
      bottom: padY - (padY >> 1),
      background: '#ffffff',
    })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** Adds one image, normalized as described under "FileState" in docs/pipeline.md. */
export async function addImage(state: FileState, budget: Budget, image: Sharp, source: string) {
  if (state.images.length >= budget.images) return;
  const { data, info } = await fitWithin(image, budget.image_edge);
  state.images.push({ data: await padToJpeg(data, info), mediaType: 'image/jpeg', source });
}

/** Reads the picture's size, and adds it unless an earlier extractor added an image. */
export const image: Extractor = async (file, state, budget) => {
  const decoded = await picture(file.path, file.mime);
  const { width, height, autoOrient } = await decoded.metadata();
  put(state, 'width', autoOrient?.width ?? width);
  put(state, 'height', autoOrient?.height ?? height);
  if (!state.images.length) await addImage(state, budget, decoded, 'file');
};

/** EXIF has no zone. Reading it as UTC keeps the state the same on every machine. */
function exifDate(value: string): string | undefined {
  const parts = /^(\d{4}):(\d\d):(\d\d) (\d\d:\d\d:\d\d)/.exec(value);
  return parts ? iso(`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}Z`) : undefined;
}

/** Reads author, date and camera. GPS tags are never read. */
export const exif: Extractor = async (file, state) => {
  const { default: ExifReader } = await import('exifreader');
  let tags;
  try {
    tags = ExifReader.load(await readRange(file.path, EXIF_BYTES)); // a Buffer: strings are fetched as URLs
  } catch (error) {
    if ((error as Error).name === 'MetadataMissingError') return;
    throw error;
  }
  put(state, 'author', tags.Artist?.description);
  put(state, 'created', exifDate(tags.DateTimeOriginal?.description ?? ''));
  put(state, 'camera', [tags.Make?.description, tags.Model?.description].filter(Boolean).join(' '));
};

const isNamedScreenshot = (file: SourceFile) =>
  isScreenCapture(file.path) || SCREENSHOT_NAME.test(file.name.normalize('NFC'));

const hasDisplaySize = (file: SourceFile, state: FileState) =>
  file.mime === 'image/png' &&
  !state.metadata.camera &&
  DISPLAY_SIZES.has(`${state.metadata.width}x${state.metadata.height}`);

/** A name or capture attribute is proof. A bare PNG of a display's size is only a hint. */
export const screenshot: Extractor = async (file, state) => {
  if (isNamedScreenshot(file)) put(state, 'screenshot', true);
  else if (hasDisplaySize(file, state)) put(state, 'screenshot_hint', true);
};
