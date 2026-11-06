/** The thumbnail cache. See docs/storage.md. Decoding happens in the pool, never in the server. */
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { Sharp } from 'sharp';
import { configSchema, paths } from '../core/config.ts';
import type { FileRow, FileState } from '../types.ts';
import { extractors, sniff } from './extractors.ts';
import { picture } from './images.ts';
import { openPdf, renderPage } from './pdf.ts';
import { runTask } from './index.ts';

/** shortcut: fixed, since `thumbnail` takes no config, pass the budget in if users need to tune it. */
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 200 * 2 ** 20;

/** First match wins. Which extractors give the text of a page thumbnail. */
const PAGE_SOURCES: [RegExp, string[]][] = [
  [/^message\/rfc822$/, ['eml']],
  [/^application\/vnd\.ms-outlook$/, ['msg']],
  [/^text\/html$/, ['office', 'text']],
  [/^text\//, ['text']],
  [/^application\/(vnd\.openxmlformats-|vnd\.oasis\.|rtf$|epub\+zip$)/, ['office']],
  [/^application\/(msword|vnd\.ms-)/, ['libreoffice']],
];

const PAGE_RATIO = 0.75;
const SLIDE = /presentation|powerpoint/;
const SHEET = /spreadsheet|ms-excel|^text\/(csv|tab-separated-values)$/;
const SHEET_COLUMNS = 4;
const PAGE_LINES = 16;
/** Skia does not fall back by itself, so Japanese would draw as empty boxes. */
const PAGE_FONT =
  'sans-serif, "Hiragino Sans", "Noto Sans CJK JP", "Yu Gothic", "PingFang SC", "Apple SD Gothic Neo"';
const PAGE_CHARS = 2000;

type Area = { left: number; top: number; width: number; height: number };

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** The words a page thumbnail shows, and its title if the file names one. Empty if it has none. */
async function pageText(path: string, mime: string) {
  const uses = PAGE_SOURCES.find(([pattern]) => pattern.test(mime))?.[1] ?? [];
  const { size } = await lstat(path);
  const file = { path, name: path, mime, size, deadline: Date.now() + TIMEOUT_MS };
  const state: FileState = { text: '', images: [], metadata: {}, warnings: [] };
  const { budget } = configSchema.parse({});
  for (const id of uses) await extractors[id]!(file, state, budget).catch(() => undefined);
  const { title } = state.metadata;
  return {
    title: typeof title === 'string' ? title.trim() : '',
    text: state.text
      .slice(0, PAGE_CHARS)
      .replace(/\[Image:[^\]]*\]/g, '')
      .replace(/[\p{Cc}\p{Cf}]+/gu, (m) => /[\n\t]/.exec(m)?.[0] ?? ' '),
  };
}

/** Breaks text to a width, letter by letter where needed: Japanese has no spaces to break at. */
function wrap(text: string, fits: (line: string) => boolean, limit: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph.replaceAll('\t', ' ').trim()) {
      if (!fits(line + char)) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    if (line) lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines.slice(0, limit);
}

/** Ruled cells, as a spreadsheet looks. Text past a cell's width is cut. */
function drawSheet(context: SKRSContext2D, text: string, area: Area, body: number) {
  const { left, top, width, height } = area;
  const rowHeight = body * 1.6;
  const cell = width / SHEET_COLUMNS;
  context.strokeStyle = '#c9ccd2';
  text
    .split('\n')
    .slice(0, Math.floor(height / rowHeight))
    .forEach((row, index) => {
      const y = top + index * rowHeight;
      for (let column = 0; column < SHEET_COLUMNS; column++) {
        const x = left + column * cell;
        context.strokeRect(x, y, cell, rowHeight);
        context.save();
        context.beginPath();
        context.rect(x, y, cell, rowHeight);
        context.clip();
        context.fillText(row.split(/[\t,]/)[column]?.trim() ?? '', x + body * 0.3, y + body * 0.3);
        context.restore();
      }
    });
}

/**
 * The file's words on a sheet of paper, a slide or a grid, drawn from extracted text. Nothing in the
 * file runs and nothing it links to loads, so this is safe for HTML, and it looks the same on every
 * OS. White in both themes, as paper is.
 */
async function drawPage(
  mime: string,
  page: { title: string; text: string },
  edge: number,
): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const slide = SLIDE.test(mime);
  const width = slide ? edge : Math.round(edge * PAGE_RATIO);
  const height = slide ? Math.round(edge * 0.5625) : edge;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  const margin = edge / 18;
  const body = (edge - 2 * margin) / PAGE_LINES / 1.45;
  const fits = (line: string) => context.measureText(line).width <= width - 2 * margin;
  context.textBaseline = 'top';
  let { title, text } = page;
  if (slide && !title) [title = '', text = ''] = text.split(/\n(.*)/s);
  let y = margin;
  if (title) {
    const size = body * (slide ? 1.8 : 1.35);
    context.font = `600 ${size}px ${PAGE_FONT}`;
    context.fillStyle = '#1b1c1f';
    for (const line of wrap(title, fits, 2)) {
      context.fillText(line, margin, y);
      y += size * 1.35;
    }
    y += body * 0.5;
  }
  context.font = `${body}px ${PAGE_FONT}`;
  context.fillStyle = '#4d5159';
  if (SHEET.test(mime)) {
    const area = { left: margin, top: y, width: width - 2 * margin, height: height - margin - y };
    drawSheet(context, text, area, body);
    return canvas.encode('png');
  }
  const room = Math.floor((height - margin - y) / (body * 1.45));
  for (const line of wrap(text, fits, room)) {
    context.fillText(line, margin, y);
    y += body * 1.45;
  }
  return canvas.encode('png');
}

async function decode(path: string, size: number): Promise<Sharp> {
  const mime = await sniff(path);
  if (mime.startsWith('image/')) return picture(path, mime);
  const { default: sharp } = await import('sharp');
  if (mime === 'application/pdf') {
    const doc = await openPdf(path);
    try {
      return sharp(await renderPage(doc, 1, size));
    } finally {
      await doc.loadingTask.destroy();
    }
  }
  const page = await pageText(path, mime);
  if (!page.text.trim() && !page.title) throw new Error(`no thumbnail for ${mime}`);
  return sharp(await drawPage(mime, page, size));
}

/** Worker task: writes the webp under a temp name, then renames it into place. */
export async function renderThumbnail(input: { path: string; size: number; out: string }) {
  const temp = `${input.out}.${randomUUID()}.tmp`;
  try {
    const image = await decode(input.path, input.size);
    await image
      .autoOrient()
      .resize({ width: input.size, height: input.size, fit: 'inside', withoutEnlargement: true })
      .webp()
      .toFile(temp);
    await rename(temp, input.out);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * The path of a cached webp, or null if this file has none. `hash` is `file.hash`, which `FileRow`
 * leaves out. Without it the key comes from the file's identity, as for a file not yet organized.
 */
export async function thumbnail(
  file: FileRow & { hash?: string | null },
  size: 256 | 1024,
): Promise<string | null> {
  const info = await lstat(file.path, { bigint: true }).catch(() => undefined);
  if (!info?.isFile()) return null;
  const key =
    file.hash?.replace(/^\w+:/, '') ??
    createHash('sha256')
      .update([info.dev, info.ino, info.size, info.mtimeNs].join(':'))
      .digest('hex');
  const dir = join(paths.thumbnails(), key.slice(0, 2));
  const out = join(dir, `${key}-${size}.webp`);
  const fail = join(dir, `${key}-${size}.fail`);
  if (await exists(out)) return out;
  if ((await exists(fail)) || info.size > MAX_BYTES) return null;
  await mkdir(dir, { recursive: true });
  try {
    await runTask('renderThumbnail', { path: file.path, size, out }, TIMEOUT_MS);
    return out;
  } catch {
    await writeFile(fail, ''); // a hostile file is parsed once, not on every view
    return null;
  }
}
