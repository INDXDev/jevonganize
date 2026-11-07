/** Current Office formats, through `officeparser`. `libreoffice.ts` takes what it cannot read. */
import type { OfficeParserAST } from 'officeparser';
import type { Budget } from '../core/config.ts';
import { type Extractor, iso, passwordProtected, put, setText } from './source.ts';

type OfficeNode = OfficeParserAST['content'][number];

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
    const issue = (error as { officeIssue?: { code?: string } }).officeIssue;
    const needsPassword = issue?.code?.startsWith('PASSWORD_') === true;
    if (!needsPassword) throw error;
    return undefined;
  }
}

const isSheet = (node: OfficeNode) => node.type === 'sheet';

/** Keeps `budget.sheets` sheets of `budget.sheet_rows` rows, when the document is a workbook. */
// shortcut: caps apply after parsing, so a huge sheet is slow, stream it if that starts to matter
function capSheets(ast: OfficeParserAST, budget: Budget) {
  const isWorkbook = ast.content.some(isSheet);
  if (!isWorkbook) return;
  ast.content = ast.content
    .filter(isSheet)
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
