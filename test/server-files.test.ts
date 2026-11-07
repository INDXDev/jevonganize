import { rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ctx, home, indexed, root, send, setupServer } from './server-helpers.ts';

setupServer();

/** A 1x1 PNG, enough for a thumbnail. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('/file/:id', () => {
  test('sends bytes with nosniff and no-store, and no sandbox on a safe type', async () => {
    const id = await indexed('a.txt', 'hello');
    const response = await send(`/file/${id}`);
    expect(await response.text()).toBe('hello');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-security-policy')).not.toBe('sandbox');
  });

  test.each(['a.html', 'a.svg', 'a.xml', 'a.js', 'a.unknownext'])('sandboxes %s', async (name) => {
    const id = await indexed(name, '<script>alert(1)</script>');
    expect((await send(`/file/${id}`)).headers.get('content-security-policy')).toBe('sandbox');
  });

  test('serves a byte range as 206 with its length', async () => {
    const id = await indexed('a.txt', '0123456789');
    const part = await send(`/file/${id}`, { headers: { range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('234');
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(part.headers.get('content-length')).toBe('3');
  });

  test('serves a suffix range, and answers 416 past the end', async () => {
    const id = await indexed('a.txt', '0123456789');
    const tail = await send(`/file/${id}`, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    const past = await send(`/file/${id}`, { headers: { range: 'bytes=20-' } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */10');
  });

  test('an empty file is fine', async () => {
    const id = await indexed('a.txt', '');
    const response = await send(`/file/${id}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});

describe('/file/:id refusals', () => {
  test.each(['999', '..%2F..%2Fetc%2Fpasswd', '1e0'])('refuses the id %s', async (id) => {
    expect((await send(`/file/${id}`)).status).toBe(404);
  });

  test('refuses a file that became a link', async () => {
    const id = await indexed('a.txt', 'x');
    const outside = join(home(), 'outside.txt');
    await writeFile(outside, 'private');
    await rm(join(root, 'a.txt'));
    await symlink(outside, join(root, 'a.txt'));
    expect((await send(`/file/${id}`)).status).toBe(404);
  });

  test('refuses a file that is now excluded', async () => {
    const id = await indexed('a.txt', 'x');
    ctx.config.exclude.push('a.txt');
    expect((await send(`/file/${id}`)).status).toBe(404);
  });

  test('refuses a file outside any current library', async () => {
    const id = await indexed('a.txt', 'x');
    ctx.db.moveFile(id, join(home(), 'elsewhere.txt'));
    expect((await send(`/file/${id}`)).status).toBe(404);
  });
});

describe('/thumb/:id', { timeout: 35_000 }, () => {
  test('serves a cached webp, immutable', async () => {
    const id = await indexed('a.png', ONE_PIXEL_PNG);
    const response = await send(`/thumb/${id}?size=256&v=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  test('is 404 for a file with no thumbnail, or an unknown one', async () => {
    const id = await indexed('a.bin', Buffer.from([0, 1, 2, 3, 255]));
    expect((await send(`/thumb/${id}`)).status).toBe(404);
    expect((await send('/thumb/999')).status).toBe(404);
  });
});
