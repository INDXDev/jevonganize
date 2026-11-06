/** Office documents: `officeparser` for current formats, and `soffice` for what it cannot read. */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { threadId, workerData } from 'node:worker_threads';
import type { OfficeParserAST } from 'officeparser';
import type { Budget } from '../core/config.ts';
import { pdf, pdfRender } from './pdf.ts';
import { type Extractor, iso, passwordProtected, put, setText } from './source.ts';
import { findTool, runTool, withTempDir } from './tools.ts';

/** Level 3 runs nothing unsigned from anywhere, and the second turns macros off altogether. */
const NO_MACROS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

/**
 * A profile for `soffice`, which takes seconds to create. Two runs cannot share one, so each worker
 * keeps its own, and runs one task at a time. Off the pool it lasts for this one file.
 */
async function sofficeProfile(scratch: string): Promise<string> {
  const root = (workerData as { profileRoot?: string } | null)?.profileRoot;
  const profile = root ? join(root, String(threadId)) : join(scratch, 'profile');
  const settings = join(profile, 'user', 'registrymodifications.xcu');
  await mkdir(join(profile, 'user'), { recursive: true, mode: 0o700 });
  // `wx`: soffice adds to this file, and what it added is what makes the next start fast.
  await writeFile(settings, NO_MACROS, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return profile;
}

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
    const profile = await sofficeProfile(dir);
    const installation = `-env:UserInstallation=${pathToFileURL(profile).href}`;
    const flags = ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir];
    await runTool(soffice, [installation, ...flags, file.path], file).catch(
      async (error: unknown) => {
        // A killed run leaves its lock behind, which would stop the next one.
        await rm(profile, { recursive: true, force: true });
        throw error;
      },
    );
    const pdfName = (await readdir(dir)).find((name) => name.endsWith('.pdf'));
    if (!pdfName) throw new Error('soffice wrote no PDF');
    const path = join(dir, pdfName);
    const converted = { ...file, path, size: (await stat(path)).size };
    await pdf(converted, state, budget);
    await pdfRender(converted, state, budget);
  });
};
