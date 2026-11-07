/**
 * A file's words drawn on a sheet of paper, a slide or a grid. Nothing in the file runs and nothing
 * it links to loads, so this is safe for HTML, and it looks the same on every OS. White in both
 * themes, as paper is. Worker code.
 */
import type { SKRSContext2D } from '@napi-rs/canvas';

/** What a page image shows: the file's title, if it names one, and its text. */
export type PageWords = { title: string; text: string };

/** A portrait page is 3:4, and a slide is 16:9. */
const PAGE_RATIO = 0.75;
const SLIDE_RATIO = 0.5625;
const SLIDE_MIME = /presentation|powerpoint/;
const SHEET_MIME = /spreadsheet|ms-excel|^text\/(csv|tab-separated-values)$/;
const SHEET_COLUMNS = 4;
const LINES_PER_PAGE = 16;
const LINE_SPACING = 1.45;
const TITLE_LINES = 2;
/** Skia does not fall back by itself, so Japanese would draw as empty boxes. */
const FONT_STACK =
  'sans-serif, "Hiragino Sans", "Noto Sans CJK JP", "Yu Gothic", "PingFang SC", "Apple SD Gothic Neo"';
const PAPER_COLOR = '#ffffff';
const TITLE_COLOR = '#1b1c1f';
const BODY_COLOR = '#4d5159';
const GRID_COLOR = '#c9ccd2';

type Area = { left: number; top: number; width: number; height: number };

/** Breaks text to a width, letter by letter where needed: Japanese has no spaces to break at. */
function wrapLines(text: string, fitsWidth: (line: string) => boolean, maxLines: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph.replaceAll('\t', ' ').trim()) {
      if (!fitsWidth(line + char)) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    if (line) lines.push(line);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

/** Ruled cells, as a spreadsheet looks. Text past a cell's width is cut. */
function drawSheet(context: SKRSContext2D, text: string, area: Area, fontSize: number) {
  const { left, top, width, height } = area;
  const rowHeight = fontSize * 1.6;
  const cellWidth = width / SHEET_COLUMNS;
  const padding = fontSize * 0.3;
  const rows = text.split('\n').slice(0, Math.floor(height / rowHeight));
  context.strokeStyle = GRID_COLOR;
  rows.forEach((row, index) => {
    const y = top + index * rowHeight;
    const cells = row.split(/[\t,]/);
    for (let column = 0; column < SHEET_COLUMNS; column++) {
      const x = left + column * cellWidth;
      context.strokeRect(x, y, cellWidth, rowHeight);
      context.save();
      context.beginPath();
      context.rect(x, y, cellWidth, rowHeight);
      context.clip();
      context.fillText(cells[column]?.trim() ?? '', x + padding, y + padding);
      context.restore();
    }
  });
}

/** A blank page or slide, its longest side `edge` pixels, with the measures drawing on it uses. */
async function blankPage(isSlide: boolean, edge: number) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const width = isSlide ? edge : Math.round(edge * PAGE_RATIO);
  const height = isSlide ? Math.round(edge * SLIDE_RATIO) : edge;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = PAPER_COLOR;
  context.fillRect(0, 0, width, height);
  context.textBaseline = 'top';
  const margin = edge / 18;
  const bodyFontSize = (edge - 2 * margin) / LINES_PER_PAGE / LINE_SPACING;
  // Measures with whichever font is set when called, so it serves the title and the body alike.
  const fitsWidth = (line: string) => context.measureText(line).width <= width - 2 * margin;
  return { canvas, context, width, height, margin, bodyFontSize, fitsWidth };
}

type BlankPage = Awaited<ReturnType<typeof blankPage>>;

/** Draws the title from the top margin, and returns where the body starts. */
function drawTitle(page: BlankPage, title: string, isSlide: boolean): number {
  const { context, margin, bodyFontSize } = page;
  const titleFontSize = bodyFontSize * (isSlide ? 1.8 : 1.35);
  context.font = `600 ${titleFontSize}px ${FONT_STACK}`;
  context.fillStyle = TITLE_COLOR;
  let y = margin;
  for (const line of wrapLines(title, page.fitsWidth, TITLE_LINES)) {
    context.fillText(line, margin, y);
    y += titleFontSize * 1.35;
  }
  return y + bodyFontSize * 0.5;
}

/** Draws as many lines of text as fit between `top` and the bottom margin. */
function drawLines(page: BlankPage, text: string, top: number): void {
  const { context, margin, bodyFontSize, height } = page;
  const lineHeight = bodyFontSize * LINE_SPACING;
  const linesThatFit = Math.floor((height - margin - top) / lineHeight);
  let y = top;
  for (const line of wrapLines(text, page.fitsWidth, linesThatFit)) {
    context.fillText(line, margin, y);
    y += lineHeight;
  }
}

/** A slide with no title of its own takes its first line as one. */
function withSlideTitle(words: PageWords, isSlide: boolean): PageWords {
  if (!isSlide || words.title) return words;
  const [title = '', text = ''] = words.text.split(/\n(.*)/s);
  return { title, text };
}

/** Draws `words` as the kind of page `mime` is, and encodes it as a PNG. */
export async function drawPage(mime: string, words: PageWords, edge: number): Promise<Buffer> {
  const isSlide = SLIDE_MIME.test(mime);
  const page = await blankPage(isSlide, edge);
  const { title, text } = withSlideTitle(words, isSlide);
  const bodyTop = title ? drawTitle(page, title, isSlide) : page.margin;
  const { context, margin, width, height, bodyFontSize } = page;
  context.font = `${bodyFontSize}px ${FONT_STACK}`;
  context.fillStyle = BODY_COLOR;
  if (SHEET_MIME.test(mime)) {
    const below = { left: margin, top: bodyTop, width: width - 2 * margin };
    drawSheet(context, text, { ...below, height: height - margin - bodyTop }, bodyFontSize);
  } else {
    drawLines(page, text, bodyTop);
  }
  return page.canvas.encode('png');
}
