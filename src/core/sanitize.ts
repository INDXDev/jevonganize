/** Makes untrusted text safe to print. The interface layer calls this once, at its output boundary. */
import { isTable } from './config.ts';

/** See docs/security.md. The zero-width joiner survives only between emoji, so `👩🏽‍💻` stays whole. */
const UNSAFE =
  /[[\p{Cc}--[\n\t]][\p{Cf}--[\u200D]]\p{Zl}\p{Zp}\u{E0000}-\u{E0FFF}]|(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}]\uFE0F?)\u200D|\u200D(?!\p{Extended_Pictographic})/gv;

/** For multi-line text: replaces whatever could drive a terminal or disguise a name, keeps layout. */
export const sanitize = (text: string): string => text.replace(UNSAFE, '?');

/** For a value on one line, such as a name in a table: `\n` and `\t` go too. */
export const sanitizeLine = (text: string): string => sanitize(text).replace(/[\n\t]/g, '?');

/** Applies `sanitizeLine` to every string in a JSON value, keys included: tags can be keys. */
export function sanitizeData<T>(data: T): T;
export function sanitizeData(data: unknown): unknown {
  if (typeof data === 'string') return sanitizeLine(data);
  if (Array.isArray(data)) return data.map((item) => sanitizeData(item));
  if (!isTable(data)) return data;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [sanitizeLine(key), sanitizeData(value)]),
  );
}
