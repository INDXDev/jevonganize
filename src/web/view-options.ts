import { t } from './i18n/index.ts';
/** How the file list is drawn from the `[view]` config: pure functions, so they test without a DOM. */
import type { ViewOptions } from '../core/config.ts';
import type { FileRow } from '../types.ts';

/** Width over height of a tile's thumbnail. */
const THUMB_RATIO = 1.25;
/** Height in pixels of the line under the name, and the gap above the label. */
const INFO_LINE = 16;
const LABEL_GAP = 6;

type Grid = Pick<
  ViewOptions,
  'thumbnail_size' | 'grid_columns' | 'grid_spacing' | 'grid_info' | 'text_size'
>;

/** The grid for a width in pixels. Config sizes are pixels at 100%, so they follow the UI scale. */
export function gridLayout(width: number, rem: number, options: Grid) {
  const unit = rem / 16;
  const gap = options.grid_spacing * unit;
  const fit = Math.floor((width + gap) / (options.thumbnail_size * unit + gap));
  const columns = options.grid_columns || Math.max(1, fit);
  const tile = Math.max(0, (width - gap * (columns - 1)) / columns);
  const info = options.grid_info === 'none' ? 0 : INFO_LINE;
  const label = (options.text_size * 1.5 + info + LABEL_GAP) * unit;
  return { columns, gap, tile, rowHeight: tile / THUMB_RATIO + label + gap };
}

/** The height of a list row, which grows with its text and thumbnail. */
export function lineHeight(rem: number, base: number, options: ViewOptions) {
  const unit = rem / 16;
  return Math.max(base, options.text_size * 2 * unit, options.list_thumbnails ? 40 * unit : 0);
}

/** A file name as the list shows it. A dotfile such as `.zshrc` has no extension to drop. */
export const displayName = (name: string, extensions: boolean) =>
  extensions ? name : name.replace(/(?<=.)\.[^.]+$/, '');

const KINDS = [
  [/^image\//, 'Image'],
  [/^video\//, 'Video'],
  [/^audio\//, 'Audio'],
  [/pdf/, 'PDF'],
  [/sheet|excel|csv/, 'Spreadsheet'],
  [/presentation|powerpoint/, 'Presentation'],
  [/word|opendocument|rtf/, 'Document'],
  [/zip|tar|gzip|rar|7z/, 'Archive'],
  [/rfc822|outlook/, 'Email'],
  [/html/, 'Web page'],
  [/^text\/|json|xml/, 'Text'],
] as const;

/** A short name for what a file is, as Finder's Kind column gives. */
export const kindOf = ({ mime }: Pick<FileRow, 'mime'>) =>
  t(KINDS.find(([pattern]) => pattern.test(mime ?? ''))?.[1] ?? 'File');
