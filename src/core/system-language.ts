/** Resolves the local machine's UI language without browser headers or renderer privileges. */
import { execFileSync } from 'node:child_process';
import koffi from 'koffi';
import type { Language } from '../types.ts';

/** Maps regional language tags to the translations this app ships. */
export function supportedLanguage(locale: string): Language {
  const code = locale.toLowerCase().split(/[-_.@]/)[0];
  return code === 'ja' ? 'ja' : code === 'zh' ? 'zh-CN' : 'en';
}

let detected: Language | undefined;

/** Detects once per process; macOS and Windows distinguish UI language from regional formats. */
export function systemLanguage(): Language {
  if (detected) return detected;
  const session =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    Intl.DateTimeFormat().resolvedOptions().locale;
  let locale = /^(C|POSIX)(?:[.@]|$)/i.test(session)
    ? session
    : process.env.LANGUAGE?.split(':')[0] || session;
  try {
    if (process.platform === 'darwin') {
      const languages = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], {
        encoding: 'utf8',
        timeout: 1000,
        maxBuffer: 16_384,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      locale = /^\s*"?([a-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?,?\s*$/m.exec(languages)?.[1] ?? locale;
    } else if (process.platform === 'win32') {
      const kernel = koffi.load('kernel32.dll');
      const getLanguage = kernel.func('uint16_t __stdcall GetUserDefaultUILanguage()');
      const primary = (getLanguage() as number) & 0x3ff;
      locale = primary === 0x11 ? 'ja' : primary === 0x04 ? 'zh' : 'en';
    }
  } catch {
    // A restricted machine can refuse its native preference; the session locale remains usable.
  }
  detected = supportedLanguage(locale);
  return detected;
}
