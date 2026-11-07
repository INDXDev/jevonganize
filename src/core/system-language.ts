/**
 * The local machine's UI language, without browser headers or renderer privileges. macOS and Windows
 * know a UI language apart from the regional format, so their own setting wins; elsewhere, and when
 * that setting cannot be read, the session locale decides. Detected once per process.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseBuffer } from 'bplist-parser';
import type { Language } from '../types.ts';

/** `LANG=C` and `LANG=POSIX` mean "no preference", so `LANGUAGE` must not override them. */
const NEUTRAL_LOCALE = /^(C|POSIX)(?:[.@]|$)/i;

/** One line of `defaults read -g AppleLanguages`, such as `    "ja-JP",`. */
const DEFAULTS_LANGUAGE_LINE = /^\s*"?([a-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?,?\s*$/m;

/** Windows primary language ids, the low 10 bits of a LANGID. */
const WINDOWS_JAPANESE = 0x11;
const WINDOWS_CHINESE = 0x04;
const PRIMARY_LANGUAGE_MASK = 0x3ff;

/** Maps regional language tags to the translations this app ships. */
export function supportedLanguage(locale: string): Language {
  const code = locale.toLowerCase().split(/[-_.@]/)[0];
  if (code === 'ja') return 'ja';
  if (code === 'zh') return 'zh-CN';
  return 'en';
}

/** The locale of the shell or session, as POSIX tools would see it. */
function sessionLocale(): string {
  const posixLocale =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    Intl.DateTimeFormat().resolvedOptions().locale;
  if (NEUTRAL_LOCALE.test(posixLocale)) return posixLocale;
  const firstPreferred = process.env.LANGUAGE?.split(':')[0];
  return firstPreferred || posixLocale;
}

/** What `defaults read -g AppleLanguages` prints the first of, without starting a process. */
function macPreferredLanguage(): string | undefined {
  const file = join(homedir(), 'Library/Preferences/.GlobalPreferences.plist');
  const [preferences] = parseBuffer<{ AppleLanguages?: unknown[] }>(readFileSync(file));
  const [first] = preferences?.AppleLanguages ?? [];
  return typeof first === 'string' ? first : undefined;
}

/** The first of the user's preferred languages, as the `defaults` tool reports it. */
function macDefaultsLanguage(): string | undefined {
  const output = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], {
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 16_384,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return DEFAULTS_LANGUAGE_LINE.exec(output)?.[1];
}

/** The macOS UI language: the preferences file first, then `defaults`. */
function macLanguage(): string | undefined {
  try {
    const preferred = macPreferredLanguage();
    if (preferred !== undefined) return preferred;
  } catch {
    // The file's format is Apple's to change, and `defaults` always knows it.
  }
  return macDefaultsLanguage();
}

/** The Windows UI language, which can differ from the regional format the session reports. */
async function windowsLanguage(): Promise<string> {
  const { default: koffi } = await import('koffi');
  const kernel = koffi.load('kernel32.dll');
  const getLanguage = kernel.func('uint16_t __stdcall GetUserDefaultUILanguage()');
  const primary = (getLanguage() as number) & PRIMARY_LANGUAGE_MASK;
  if (primary === WINDOWS_JAPANESE) return 'ja';
  if (primary === WINDOWS_CHINESE) return 'zh';
  return 'en';
}

/** The OS's own UI language, or undefined where only the session locale is known. */
async function nativeLanguage(): Promise<string | undefined> {
  if (process.platform === 'darwin') return macLanguage();
  if (process.platform === 'win32') return windowsLanguage();
  return undefined;
}

let detected: Language | undefined;

/** Detects once per process; macOS and Windows distinguish UI language from regional formats. */
export async function systemLanguage(): Promise<Language> {
  detected ??= supportedLanguage((await nativeLanguageIfReadable()) ?? sessionLocale());
  return detected;
}

/** The OS's own UI language, or undefined when it is unknown or cannot be read. */
async function nativeLanguageIfReadable(): Promise<string | undefined> {
  try {
    return await nativeLanguage();
  } catch {
    // A restricted machine can refuse its native preference; the session locale remains usable.
    return undefined;
  }
}
