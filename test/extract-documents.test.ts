import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { isFailed } from '../src/extract/index.ts';
import { openPdf } from '../src/extract/pdf.ts';
import { extract, setupExtract, tools } from './extract-helpers.ts';

setupExtract();

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
});

describe('Office limits and legacy formats', () => {
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

describe('openPdf', () => {
  it('prints nothing for a PDF with font problems', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jevonganize-pdf-'));
    const file = join(dir, 'odd-font.pdf');
    await writeFile(
      file,
      [
        '%PDF-1.4',
        '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<<>>>>endobj',
        '4 0 obj<</Length 34>>stream\nBT /Nope 12 Tf 10 10 Td (hi) Tj ET\nendstream endobj',
        'trailer<</Root 1 0 R>>',
      ].join('\n'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = await openPdf(file);
    await (await doc.getPage(1)).getTextContent();
    await doc.loadingTask.destroy();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });
});
