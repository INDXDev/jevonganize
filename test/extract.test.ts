import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFile, isFailed } from '../src/extract/index.ts';
import { config, extract, fixture, setupExtract, temp, tools } from './extract-helpers.ts';

setupExtract();

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
    expect((await extract(name, {}, { pipeline: [] })).mime).toBe(mime);
  });

  it('trusts bytes over the extension', async () => {
    const path = join(temp, 'really-a-pdf.docx');
    await writeFile(path, await readFile(fixture('report.pdf')));
    const state = await extractFile(path, config());
    expect(state.mime).toBe('application/pdf');
    expect(state.text).toContain('Harbor Lantern Society');
  });
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
