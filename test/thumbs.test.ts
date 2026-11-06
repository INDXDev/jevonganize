import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paths } from '../src/core/config.ts';
import { thumbnail } from '../src/extract/thumbs.ts';
import type { FileRow } from '../src/types.ts';

sharp.cache(false); // these reads run in this process, and on Windows the cache locks the file

const fixture = (name: string) => join(import.meta.dirname, 'fixtures/files', name);
const row = (path: string, hash?: string): FileRow & { hash?: string } => ({
  id: 1,
  path,
  name: path,
  size: 0,
  mtime_ms: 0,
  mime: null,
  tags: [],
  status: 'new',
  hash,
});

let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'jev-thumbs-'));
  process.env.JEVONGANIZE_HOME = home;
});
afterAll(async () => {
  delete process.env.JEVONGANIZE_HOME;
  await rm(home, { recursive: true, force: true });
});

async function pageOf(name: string, text: string) {
  const path = join(home, name);
  await writeFile(path, text);
  return sharp((await thumbnail(row(path, `f1:cc${name}`), 256))!)
    .raw()
    .toBuffer();
}

const slow = { timeout: 30_000 };

describe('thumbnail cache', slow, () => {
  it('makes a webp at a content-addressed path, and reuses it', async () => {
    const out = await thumbnail(row(fixture('photo.jpg'), 'f1:abcdef'), 256);
    expect(out).toBe(join(paths.thumbnails(), 'ab', 'abcdef-256.webp'));
    const meta = await sharp(out!).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 128, 256]);
    const made = (await stat(out!)).mtimeMs;
    expect(await thumbnail(row(fixture('report.pdf'), 'f1:abcdef'), 256)).toBe(out);
    expect((await stat(out!)).mtimeMs).toBe(made);
    expect(await readdir(dirname(out!))).toEqual(['abcdef-256.webp']);
  });

  it('keys an unhashed file on its identity, and a change gives a new key', async () => {
    const path = join(home, 'copy.png');
    await writeFile(path, await readFile(fixture('photo-exif.png')));
    const first = await thumbnail(row(path), 256);
    await writeFile(path, await readFile(fixture('display.png')));
    const second = await thumbnail(row(path), 1024);
    expect(first).toMatch(/[0-9a-f]{64}-256\.webp$/);
    expect(second).toMatch(/[0-9a-f]{64}-1024\.webp$/);
    expect((await sharp(second!).metadata()).width).toBe(1024);
    expect(first!.slice(-70, -9)).not.toBe(second!.slice(-71, -10));
  });
});

describe('thumbnail drawing', slow, () => {
  it('renders the first page of a PDF, even a scanned one', async () => {
    for (const [name, hash] of [
      ['report.pdf', 'f1:11'],
      ['scanned.pdf', 'f1:22'],
    ] as const) {
      const out = await thumbnail(row(fixture(name), hash), 256);
      expect(await sharp(out!).metadata()).toMatchObject({ format: 'webp', height: 256 });
    }
  });

  it('handles HEIC and SVG', async () => {
    expect(await thumbnail(row(fixture('photo.heic'), 'f1:33'), 256)).toMatch(/webp$/);
    expect(await thumbnail(row(fixture('logo.svg'), 'f1:44'), 256)).toMatch(/webp$/);
  });

  it.each([
    'page.html',
    'table.csv',
    'readme.md',
    'mail.eml',
    'plan.docx',
    'budget.xlsx',
    'note.rtf',
  ])('draws %s as a page of its text', async (name) => {
    const out = await thumbnail(row(fixture(name), `f1:a${name.length}${name[0]}`), 256);
    const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    expect(info.height).toBeGreaterThan(info.width);
    expect(data.some((value) => value < 128)).toBe(true); // ink on the paper, not a blank sheet
  });

  // Linux CI has no Japanese font, and there every letter is the same box.
  it.runIf(process.platform === 'darwin')('draws Japanese with a real font', async () => {
    const [one, other] = [await pageOf('a.txt', 'あいう'), await pageOf('b.txt', '東西南')];
    expect(one.equals(other)).toBe(false); // a missing font draws every letter the same
  });

  it('draws a presentation as a slide', async () => {
    const out = await thumbnail(row(fixture('converted.pptx'), 'f1:b1'), 256);
    const { width, height } = await sharp(out!).metadata();
    expect(width).toBeGreaterThan(height);
  });

  it('leaves video to the browser', async () => {
    expect(await thumbnail(row(fixture('clip.mp4'), 'f1:b2'), 256)).toBeNull();
  });
});

describe('thumbnail failures', slow, () => {
  it('leaves a .fail marker for a bad file, and does not parse it again', async () => {
    const path = join(home, 'bad.jpg');
    await writeFile(path, await readFile(fixture('truncated.jpg')));
    expect(await thumbnail(row(path, 'f1:55aa'), 256)).toBeNull();
    const fail = join(paths.thumbnails(), '55', '55aa-256.fail');
    expect((await stat(fail)).size).toBe(0);
    await writeFile(path, await readFile(fixture('photo.jpg')));
    expect(await thumbnail(row(path, 'f1:55aa'), 256)).toBeNull();
    expect(await readdir(dirname(fail))).toEqual(['55aa-256.fail']);
  });

  it('fails what it cannot draw, and still serves good files after', async () => {
    expect(await thumbnail(row(fixture('noise.bin'), 'f1:66'), 256)).toBeNull();
    expect(await thumbnail(row(fixture('archive.zip'), 'f1:67'), 256)).toBeNull();
    expect(await thumbnail(row(fixture('locked.pdf'), 'f1:77'), 256)).toBeNull();
    expect(await thumbnail(row(fixture('photo.jpg'), 'f1:88'), 256)).toMatch(/webp$/);
  });

  it('refuses a link or a missing file, leaving no marker', async () => {
    const link = join(home, 'link.jpg');
    await symlink(fixture('photo.jpg'), link);
    expect(await thumbnail(row(link, 'f1:99'), 256)).toBeNull();
    expect(await thumbnail(row(join(home, 'gone.jpg'), 'f1:99'), 256)).toBeNull();
    await expect(stat(join(paths.thumbnails(), '99'))).rejects.toThrow('ENOENT');
  });
});
