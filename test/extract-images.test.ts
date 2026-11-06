import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extract, setupExtract } from './extract-helpers.ts';

setupExtract();

describe('images', () => {
  it('reads EXIF from a PNG, and never GPS', async () => {
    const state = await extract('photo-exif.png');
    expect(state.metadata).toMatchObject({
      width: 320,
      height: 200,
      camera: 'Fictional Harbor 1',
      author: 'Mira Quill',
      created: '2023-07-04T18:30:00.000Z',
    });
    expect(JSON.stringify(state.metadata)).not.toMatch(/gps|35/i);
  });

  it('normalizes a JPEG: rotated, stripped, and padded to the minimum edge', async () => {
    const state = await extract('photo.jpg');
    expect(state.metadata).toMatchObject({ width: 320, height: 640 });
    const meta = await sharp(state.images[0]!.data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 320, 640]);
    expect(meta.exif).toBeUndefined();
    expect(state.images[0]).toMatchObject({ mediaType: 'image/jpeg', source: 'file' });
    expect(state.images[0]!.data).toBeInstanceOf(Uint8Array);
  });

  it('flattens transparency onto white and pads small images', async () => {
    const { images } = await extract('tiny-transparent.png');
    const image = sharp(images[0]!.data);
    expect(await image.metadata()).toMatchObject({ width: 280, height: 280 });
    expect((await image.stats()).channels[0]!.min).toBeGreaterThan(250);
  });

  it('honours image_edge', async () => {
    const { images } = await extract('display.png', { image_edge: 300 });
    expect(await sharp(images[0]!.data).metadata()).toMatchObject({ width: 300 });
  });

  it('decodes HEIC', async () => {
    const state = await extract('photo.heic');
    expect(state.mime).toBe('image/heic');
    expect(state.images).toHaveLength(1);
    expect(state.metadata).toMatchObject({ camera: 'Fictional Harbor 1' });
    expect(Math.max(Number(state.metadata.width), Number(state.metadata.height))).toBe(640);
  });

  it('gives an SVG both text and pixels', async () => {
    const state = await extract('logo.svg');
    expect(state.text).toContain('<title>Lantern Logo</title>');
    expect(state.images).toHaveLength(1);
  });
});

describe('image flags and failures', () => {
  it('tells screenshots from hints', async () => {
    const named = await extract('Screenshot 2024-03-15 at 09.30.00.png');
    expect(named.metadata.screenshot).toBe(true);
    const hinted = await extract('display.png');
    expect(hinted.metadata).toMatchObject({ screenshot_hint: true });
    expect(hinted.metadata.screenshot).toBeUndefined();
    expect((await extract('photo-exif.png')).metadata.screenshot_hint).toBeUndefined();
  });

  it('send_images = false keeps images out, and changes nothing else', async () => {
    const off = await extract('photo.jpg', {}, { send_images: false });
    const on = await extract('photo.jpg');
    expect(off.images).toEqual([]);
    expect(on.images).toHaveLength(1);
    expect(off.metadata).toEqual(on.metadata);
    expect((await extract('scanned.pdf', {}, { send_images: false })).images).toEqual([]);
  });

  it('warns on an image that cannot be decoded', async () => {
    const state = await extract('truncated.jpg');
    expect(state.images).toEqual([]);
    expect(state.warnings.join()).toMatch(/^image: /);
  });
});
