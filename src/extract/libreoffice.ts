/** Legacy Office files, through `soffice`: converted to a PDF with macros off, then read as one. */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { threadId, workerData } from 'node:worker_threads';
import { pdf, pdfRender } from './pdf.ts';
import type { Extractor, SourceFile } from './source.ts';
import { findTool, runTool, withTempDir } from './tools.ts';

/** Level 3 runs nothing unsigned from anywhere, and the second turns macros off altogether. */
const NO_MACROS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

/** Set by the pool. A run off the pool, as in a test, has none. */
const poolProfileRoot = () => (workerData as { profileRoot?: string } | null)?.profileRoot;

/**
 * A profile for `soffice`, which takes seconds to create. Two runs cannot share one, so each worker
 * keeps its own, and runs one task at a time. Off the pool it lasts for this one file.
 */
async function sofficeProfile(tempDir: string): Promise<string> {
  const root = poolProfileRoot();
  const profile = root ? join(root, String(threadId)) : join(tempDir, 'profile');
  const userDir = join(profile, 'user');
  await mkdir(userDir, { recursive: true, mode: 0o700 });
  // soffice adds to this file, and what it added is what makes the next start fast.
  await writeUnlessExists(join(userDir, 'registrymodifications.xcu'), NO_MACROS);
  return profile;
}

async function writeUnlessExists(path: string, text: string): Promise<void> {
  try {
    await writeFile(path, text, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/** Runs `soffice` to write `file` as a PDF into `outDir`, and returns that PDF's path. */
async function convertToPdf(soffice: string, file: SourceFile, outDir: string): Promise<string> {
  const profile = await sofficeProfile(outDir);
  const installation = `-env:UserInstallation=${pathToFileURL(profile).href}`;
  const flags = ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir];
  try {
    await runTool(soffice, [installation, ...flags, file.path], file);
  } catch (error) {
    // A killed run leaves its lock behind, which would stop the next one.
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
  const pdfName = (await readdir(outDir)).find((name) => name.endsWith('.pdf'));
  if (!pdfName) throw new Error('soffice wrote no PDF');
  return join(outDir, pdfName);
}

/** Converts what no parser read to a PDF in a temp directory, then reads that as a PDF. */
export const libreoffice: Extractor = async (file, state, budget) => {
  const soffice = findTool('soffice');
  const isAlreadyRead = Boolean(state.text);
  if (!soffice || isAlreadyRead) return;
  await withTempDir(async (dir) => {
    const pdfPath = await convertToPdf(soffice, file, dir);
    const converted = { ...file, path: pdfPath, size: (await stat(pdfPath)).size };
    await pdf(converted, state, budget);
    await pdfRender(converted, state, budget);
  });
};
