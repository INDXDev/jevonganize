/** Office documents: `officeparser` for current formats, and `soffice` for what it cannot read. */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OfficeParserAST } from 'officeparser';
import type { Budget } from '../core/config.ts';
import { pdf, pdfRender } from './pdf.ts';
import { type Extractor, iso, passwordProtected, put, setText } from './source.ts';
import { findTool, runTool, withTempDir } from './tools.ts';

/** Parses with nothing fetched or unpacked, giving undefined for a file that needs a password. */
async function parseUnlessLocked(path: string): Promise<OfficeParserAST | undefined> {
  const { parseOffice } = await import('officeparser');
  try {
    return await parseOffice(path, {
      ocr: false,
      allowRemoteAssets: false,
      extractAttachments: false,
    });
  } catch (error) {
    const code = (error as { officeIssue?: { code?: string } }).officeIssue?.code;
    if (!code?.startsWith('PASSWORD_')) throw error;
    return undefined;
  }
}

/** Keeps `budget.sheets` sheets of `budget.sheet_rows` rows, when the document is a workbook. */
// shortcut: caps apply after parsing, so a huge sheet is slow, stream it if that starts to matter
function capSheets(ast: OfficeParserAST, budget: Budget) {
  if (!ast.content.some((node) => node.type === 'sheet')) return;
  ast.content = ast.content
    .filter((node) => node.type === 'sheet')
    .slice(0, budget.sheets)
    .map((sheet) => ({ ...sheet, children: sheet.children?.slice(0, budget.sheet_rows) }));
}

/** Reads text and core properties. */
export const office: Extractor = async (file, state, budget) => {
  if (file.mime === 'application/pdf') throw new Error('PDF must not reach officeparser');
  const ast = await parseUnlessLocked(file.path);
  if (!ast) return passwordProtected(state);
  capSheets(ast, budget);
  setText(state, (await ast.to('text')).value);
  const { title, author, lastModifiedBy, created, nativeProperties } = ast.metadata;
  put(state, 'title', title);
  put(state, 'author', author);
  put(state, 'last_author', lastModifiedBy);
  put(state, 'company', nativeProperties?.Company);
  put(state, 'created', iso(created));
};

/** Converts what no parser read to a PDF in a temp directory, then reads that as a PDF. */
export const libreoffice: Extractor = async (file, state, budget) => {
  const soffice = findTool('soffice');
  if (!soffice || state.text) return;
  await withTempDir(async (dir) => {
    // shortcut: a new profile per file costs seconds, but two runs cannot share one, pool them if slow
    const profile = `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`;
    await runTool(
      soffice,
      [profile, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, file.path],
      file,
    );
    const pdfName = (await readdir(dir)).find((name) => name.endsWith('.pdf'));
    if (!pdfName) throw new Error('soffice wrote no PDF');
    const path = join(dir, pdfName);
    const converted = { ...file, path, size: (await stat(path)).size };
    await pdf(converted, state, budget);
    await pdfRender(converted, state, budget);
  });
};
