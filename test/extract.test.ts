import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/core/config.ts';
import { configSchema, UserError } from '../src/core/config.ts';
import { extractFile, isFailed, optionalTools, workerPool } from '../src/extract/index.ts';

const fixture = (name: string) => join(import.meta.dirname, 'fixtures/files', name);
const defaults = configSchema.parse({});
const config = (budget: Partial<Config['budget']> = {}, rest: Partial<Config> = {}): Config => ({
  ...defaults,
  ...rest,
  budget: { ...defaults.budget, ...budget },
});
const extract = (name: string, budget?: Partial<Config['budget']>, rest?: Partial<Config>) =>
  extractFile(fixture(name), config(budget, rest));
const tools = optionalTools();
vi.setConfig({ testTimeout: 20_000 }); // `qlmanage` takes seconds, and workers start cold

let temp: string;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'jev-extract-'));
});
afterAll(() => rm(temp, { recursive: true, force: true }));

describe('sniffing', () => {
  it.each([
    ['report.pdf', 'application/pdf'],
    ['plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['plan.doc', 'application/msword'],
    ['budget.xls', 'application/vnd.ms-excel'],
    ['message.msg', 'application/vnd.ms-outlook'],
    ['logo.svg', 'image/svg+xml'],
    ['page.html', 'text/html'],
    ['mail.eml', 'message/rfc822'],
    ['table.csv', 'text/csv'],
    ['sample.ts', 'text/plain'],
    ['Dockerfile', 'text/plain'],
    ['noise.bin', 'application/octet-stream'],
  ])('%s is %s', async (name, mime) => {
    expect((await extract(name)).mime).toBe(mime);
  });

  it('trusts bytes over the extension', async () => {
    const path = join(temp, 'really-a-pdf.docx');
    await writeFile(path, await readFile(fixture('report.pdf')));
    const state = await extractFile(path, config());
    expect(state.mime).toBe('application/pdf');
    expect(state.text).toContain('Harbor Lantern Society');
  });
});

describe('PDF', () => {
  it('reads text and metadata, and renders nothing when text is sufficient', async () => {
    const state = await extract('report.pdf');
    expect(state.text).toContain('Page three line 7');
    expect(state.metadata).toMatchObject({
      name: 'report.pdf',
      title: 'Harbor Survey',
      author: 'Mira Quill',
      producer: 'FixtureMaker 1.0',
      pages: 3,
      created: '2024-03-15T09:30:00.000Z',
    });
    expect(state.images).toEqual([]);
  });

  it('honours pdf_pages', async () => {
    const state = await extract('report.pdf', { pdf_pages: 1 });
    expect(state.text).toContain('Page one');
    expect(state.text).not.toContain('Page two');
    expect(state.metadata.pages).toBe(3);
  });

  it('renders a scanned PDF as JPEG, within render_pages', async () => {
    const state = await extract('scanned.pdf');
    expect(state.text).toBe('');
    expect(state.images.map((image) => image.source)).toEqual(['page-1', 'page-2']);
    const { format, width, height } = await sharp(state.images[0]!.data).metadata();
    expect(format).toBe('jpeg');
    expect(Math.max(width, height)).toBe(768);
    expect((await extract('scanned.pdf', { render_pages: 1 })).images).toHaveLength(1);
    expect((await extract('scanned.pdf', { images: 1 })).images).toHaveLength(1);
  });

  it('reports a password without failing the file', async () => {
    const state = await extract('locked.pdf');
    expect(state.metadata.encrypted).toBe(true);
    expect(state.warnings).toEqual(['password protected']);
    expect(isFailed(state)).toBe(false);
  });

  it('fails a corrupt file with a warning', async () => {
    const state = await extract('broken.pdf');
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toMatch(/^pdf: /);
    expect(isFailed(state)).toBe(true);
  });
});

describe('Office', () => {
  it('reads DOCX text and core properties', async () => {
    const state = await extract('plan.docx');
    expect(state.text).toContain('lantern parade');
    expect(state.metadata).toMatchObject({
      title: 'Lantern Festival Plan',
      author: 'Mira Quill',
      last_author: 'Oren Vale',
      company: 'Harbor Lantern Society',
      created: '2024-03-15T09:30:00.000Z',
    });
  });

  it('caps sheets and rows', async () => {
    const state = await extract('budget.xlsx');
    expect(state.text).toContain('sheet5-row50');
    expect(state.text).not.toContain('sheet5-row51');
    expect(state.text).not.toContain('sheet6-row1');
    const small = await extract('budget.xlsx', { sheets: 1, sheet_rows: 2 });
    expect(small.text.split('\n')).toHaveLength(2);
  });

  it.each(['converted.pptx', 'converted.odt', 'converted.ods', 'converted.odp', 'converted.epub'])(
    'reads %s',
    async (name) => {
      const state = await extract(name);
      expect(state.text).toContain('tide table');
      expect(state.warnings).toEqual([]);
    },
  );

  it('reads RTF and HTML', async () => {
    expect((await extract('note.rtf')).text).toContain('ferry bell');
    const html = await extract('page.html');
    expect(html.text).toContain('tide table');
    expect(html.text).not.toContain('<p>');
  });

  it('reports a password-protected DOCX', async () => {
    const state = await extract('locked.docx');
    expect(state.metadata.encrypted).toBe(true);
    expect(state.warnings).toEqual(['password protected']);
  });

  it('applies max_office_mb to Office files and max_parse_mb to PDF', async () => {
    const office = await extract('plan.docx', { max_office_mb: 0.0001 });
    expect(office.text).toBe('');
    expect(office.warnings).toEqual(['too large to parse']);
    expect((await extract('report.pdf', { max_office_mb: 0.0001 })).text).not.toBe('');
    const state = await extract('report.pdf', { max_parse_mb: 0.0001 });
    expect(state.warnings).toEqual(['too large to parse']);
    expect(Object.keys(state.metadata).toSorted()).toEqual(['mime', 'name', 'size']);
    expect((await extract('plan.docx', { max_parse_mb: 0.0001 })).text).not.toBe('');
  });

  it.runIf(tools.soffice)(
    'routes legacy DOC and XLS through soffice',
    async () => {
      const [doc, xls] = await Promise.all([extract('plan.doc'), extract('budget.xls')]);
      expect(doc.text).toContain('lantern parade');
      expect(doc.warnings).toEqual([]);
      expect(xls.text).toContain('sheet1-ro'); // the printed column clips the rest
    },
    60_000,
  );
});

describe('text', () => {
  it('decodes Shift_JIS', async () => {
    const state = await extract('notes.sjis.txt');
    expect(state.mime).toBe('text/plain');
    expect(state.text).toContain('港の灯籠祭りの議事録');
  });

  it('decodes Shift_JIS with no telling extension', async () => {
    const path = join(temp, 'memo');
    await writeFile(path, await readFile(fixture('notes.sjis.txt')));
    expect((await extractFile(path, config())).text).toContain('担当者は山田さんです');
  });

  it('reads head and tail of a long file, and caps to the budget', async () => {
    const path = join(temp, 'long.txt');
    await writeFile(path, `START${'x'.repeat(200_000)}END`);
    const { text } = await extractFile(path, config());
    expect(text.startsWith('START')).toBe(true);
    expect(text.endsWith('END')).toBe(true);
    expect(text).toHaveLength(8000 + '\n[...]\n'.length);
    expect(text.indexOf('\n[...]\n')).toBe(6000);
  });

  it('removes format characters but keeps the zero-width joiner', async () => {
    const path = join(temp, 'hidden.txt');
    await writeFile(path, 'pay‮me​ now 👩‍💻\n');
    expect((await extractFile(path, config())).text).toBe('payme now 👩‍💻');
  });

  it('classifies an empty or unknown file from its name alone', async () => {
    const path = join(temp, 'empty.txt');
    await writeFile(path, '');
    for (const state of [await extractFile(path, config()), await extract('noise.bin')]) {
      expect(state.text).toBe('');
      expect(state.warnings).toEqual([]);
      expect(isFailed(state)).toBe(false);
    }
  });
});

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

describe('audio and video', () => {
  it('reads MP3 tags and duration', async () => {
    const state = await extract('song.mp3');
    expect(state.mime).toBe('audio/mpeg');
    expect(state.metadata).toMatchObject({
      title: 'Harbor Lights',
      artist: 'The Pier Quartet',
      album: 'Night Ferry',
      genre: 'Jazz',
    });
    expect(state.metadata.codec).toMatch(/MPEG/);
    expect(state.metadata.duration).toBeGreaterThan(0.5);
    expect(state.images).toEqual([]);
  });

  it.runIf(tools.ffmpeg)('takes frames from video', async () => {
    const state = await extract('clip.mp4');
    expect(state.mime).toBe('video/mp4');
    expect(state.metadata.duration).toBeCloseTo(2, 0);
    expect(state.images.map((image) => image.source)).toEqual(['frame-1', 'frame-2']);
    expect(state.warnings).toEqual([]);
  });
});

describe('mail and archives', () => {
  it('reads an .eml, naming attachments without opening them', async () => {
    const state = await extract('mail.eml');
    expect(state.text).toBe('港の予定\n\nThe parade route is attached.');
    expect(state.metadata).toMatchObject({
      subject: '港の予定',
      from: 'Mira Quill <mira@example.test>',
      to: 'Oren Vale <oren@example.test>, Tess Rowe <tess@example.test>',
      created: '2024-03-15T09:30:00.000Z',
      attachments: 'route.pdf',
    });
  });

  it('reads an HTML-only .eml as plain text', async () => {
    const path = join(temp, 'html.eml');
    await writeFile(
      path,
      'Subject: Tide\r\nContent-Type: text/html\r\n\r\n<style>p{}</style><p>High at <b>noon</b></p>',
    );
    const { text } = await extractFile(path, config());
    expect(text).toContain('High at');
    expect(text).not.toMatch(/<|p\{/);
  });

  it('reads a synthetic .msg', async () => {
    const state = await extract('message.msg');
    expect(state.warnings).toEqual([]);
    expect(state.text).toContain('Ferry timetable change');
    expect(state.text).toContain('evening ferry');
    expect(state.metadata.subject).toBe('Ferry timetable change');
    expect(state.metadata.to).toContain('Oren Vale');
  });

  it('lists a zip without unpacking it, within zip_entries', async () => {
    const state = await extract('archive.zip');
    expect(state.text.split('\n')).toEqual([
      'minutes/2024-01.txt',
      'minutes/2024-02.txt',
      'budget.csv',
    ]);
    expect(state.metadata.entries).toBe(3);
    expect(state.metadata.encrypted).toBeUndefined();
    const capped = await extract('archive.zip', { zip_entries: 1, max_parse_mb: 0.0001 });
    expect(capped.text).toBe('minutes/2024-01.txt');
    expect(capped.metadata.entries).toBe(3);
  });

  it('flags an encrypted zip and still lists it', async () => {
    const state = await extract('locked.zip');
    expect(state.metadata.encrypted).toBe(true);
    expect(state.text).toBe('secret/plans.txt');
  });
});

describe('the pipeline', () => {
  it('rejects an unknown extractor as a config error', async () => {
    const bad = config({}, { pipeline: [{ match: '*', use: ['nope'] }] });
    await expect(extractFile(fixture('table.csv'), bad)).rejects.toThrow(UserError);
  });

  it('gives a file that matches no row only name, size and mime', async () => {
    const state = await extract(
      'table.csv',
      {},
      { pipeline: [{ match: 'image/*', use: ['image'] }] },
    );
    expect(Object.keys(state.metadata).toSorted()).toEqual(['mime', 'name', 'size']);
    expect(state.text).toBe('');
  });

  it('caps metadata and leaves out the folder', async () => {
    const path = join(temp, 'long.eml');
    await writeFile(path, `Subject: ${'s​'.repeat(2000)}\r\n\r\nbody`);
    const { metadata } = await extractFile(path, config());
    expect(metadata.subject).toBe('s'.repeat(500));
    expect(metadata.name).toBe('long.eml');
    expect(JSON.stringify(metadata)).not.toContain(temp);
  });

  it('opens regular files only', async () => {
    const link = join(temp, 'link.pdf');
    await symlink(fixture('report.pdf'), link);
    for (const path of [link, temp, join(temp, 'missing.txt')]) {
      const state = await extractFile(path, config());
      expect(state.warnings).toEqual(['not a regular file']);
      expect(isFailed(state)).toBe(true);
    }
  });

  it('terminates on timeout, failing that file and no other', async () => {
    const state = await extract('report.pdf', { timeout_seconds: 0.001 });
    expect(state.warnings).toEqual(['timed out']);
    expect(state.metadata).toMatchObject({ name: 'report.pdf', mime: 'application/pdf' });
    expect(isFailed(state)).toBe(true);
    expect((await extract('report.pdf')).text).not.toBe('');
  });

  it('fails one file when its worker dies mid-task', async () => {
    const pool = workerPool();
    // With no idle worker the task needs a new one, and piscina hands it over as that one is ready.
    await Promise.all(pool.threads.map((thread) => thread.terminate()));
    const ready = once(pool, 'workerCreate');
    const running = extract('photo.heic', { timeout_seconds: 5 });
    await ready;
    await new Promise(setImmediate);
    await Promise.all(pool.threads.map((thread) => thread.terminate()));
    const state = await running;
    expect(state.warnings[0]).toMatch(/^worker failed/);
    expect(isFailed(state)).toBe(true);
    expect((await extract('table.csv')).text).toContain('lantern oil');
  });

  it('times out a task whose worker dies while starting, in a process with nothing else alive', async () => {
    const script = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile, workerPool } from './src/extract/index.ts';
      const config = configSchema.parse({ budget: { timeout_seconds: 1 } });
      const running = extractFile(process.argv[1], config);
      while (!workerPool().threads.length) await new Promise(setImmediate);
      await Promise.all(workerPool().threads.map((thread) => thread.terminate()));
      process.stdout.write((await running).warnings.join());`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '--eval', script, fixture('table.csv')],
      { cwd: join(import.meta.dirname, '..') },
    );
    expect(stdout).toBe('timed out');
  }, 30_000);

  it('does not count time queued behind other files against a timeout', async () => {
    const paths = Array.from({ length: 200 }, () => extract('photo.jpg', { timeout_seconds: 5 }));
    const states = await Promise.all(paths);
    expect(states.every((state) => state.images.length === 1)).toBe(true);
  }, 60_000);

  // Needs a shell script standing in for `ffmpeg`. Windows looks for a compiled `ffmpeg.exe`.
  it.skipIf(process.platform === 'win32')(
    'runs from source with plain Node, kills a hung tool, and lets the process exit',
    async () => {
      const bin = join(temp, 'bin');
      const pidFile = join(temp, 'tool.pid');
      await promisify(execFile)('mkdir', ['-p', bin]);
      await writeFile(join(bin, 'ffmpeg'), `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`);
      await chmod(join(bin, 'ffmpeg'), 0o755);
      const script = `
      import { configSchema } from './src/core/config.ts';
      import { extractFile } from './src/extract/index.ts';
      const config = configSchema.parse({ budget: { timeout_seconds: 3 } });
      const state = await extractFile(process.argv[1], config);
      process.stdout.write(JSON.stringify({ text: state.text, warnings: state.warnings }));`;
      const started = Date.now();
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '--eval', script, fixture('clip.mp4')],
        {
          cwd: join(import.meta.dirname, '..'),
          env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
        },
      );
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(JSON.parse(stdout).warnings.join()).toMatch(/ffmpeg-frames/);
      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');
    },
    30_000,
  );
});
