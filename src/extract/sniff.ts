/** What a file is: its MIME type from its bytes, and whether those bytes are text. Worker code. */
import { readRange } from './source.ts';

/** What `file-type` needs to see to recognize any format it knows. */
const SNIFF_BYTES = 4100;
const LEGACY_CJK_CHARSET = /^(Shift_JIS|EUC-|GB18030|Big5|ISO-2022)/;
const TEXT_MIME = /^(text\/|image\/svg\+xml$|message\/rfc822$)/;
/** An OLE container: legacy Office and Outlook files share it, so the name says which it is. */
const OLE_CONTAINER = 'application/x-cfb';

/** True when the bytes decode cleanly in `charset`. `stream` forgives a character cut at the end. */
function decodesAs(charset: string, bytes: Buffer): boolean {
  try {
    new TextDecoder(charset, { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** `isbinaryfile` calls Shift_JIS binary, so a legacy CJK charset that decodes cleanly counts as text. */
export async function looksLikeText(bytes: Buffer): Promise<boolean> {
  const { isBinaryFile } = await import('isbinaryfile');
  if (!(await isBinaryFile(bytes))) return true;
  if (bytes.includes(0)) return false;
  const { detect } = await import('chardet');
  const charset = detect(bytes);
  if (!charset || !LEGACY_CJK_CHARSET.test(charset)) return false;
  return decodesAs(charset, bytes);
}

/** The file's MIME type. See "Sniffing" in docs/pipeline.md. */
export async function sniff(path: string): Promise<string> {
  const { fileTypeFromFile } = await import('file-type');
  const fromContent = (await fileTypeFromFile(path))?.mime;
  if (fromContent && fromContent !== OLE_CONTAINER) return fromContent;
  const { default: mime } = await import('mime');
  const fromName = mime.getType(path);
  const isText = await looksLikeText(await readRange(path, SNIFF_BYTES));
  if (!isText) return fromName ?? 'application/octet-stream';
  return fromName && TEXT_MIME.test(fromName) ? fromName : 'text/plain';
}
