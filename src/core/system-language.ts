/** Resolves the local machine's UI language without browser headers or renderer privileges. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseBuffer } from 'bplist-parser';
import type { Language } from '../types.ts';

/** Maps regional language tags to the translations this app ships. */
export function supportedLanguage(locale: string): Language {
  const code = locale.toLowerCase().split(/[-_.@]/)[0];
  return code === 'ja' ? 'ja' : code === 'zh' ? 'zh-CN' : 'en';
}

let detected: Language | undefined;

/** What `defaults read -g AppleLanguages` prints the first of, without starting a process. */
function macPreferredLanguage(): string | undefined {
  const file = join(homedir(), 'Library/Preferences/.GlobalPreferences.plist');
  const [preferences] = parseBuffer<{ AppleLanguages?: unknown[] }>(readFileSync(file));
  const [first] = preferences?.AppleLanguages ?? [];
  return typeof first === 'string' ? first : undefined;
}

function macDefaultsLanguage(): string | undefined {
  const languages = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], {
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 16_384,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return /^\s*"?([a-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?,?\s*$/m.exec(languages)?.[1];
}

/** Detects once per process; macOS and Windows distinguish UI language from regional formats. */
export async function systemLanguage(): Promise<Language> {
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
      let preferred: string | undefined;
      try {
        preferred = macPreferredLanguage();
      } catch {
        // The file's format is Apple's to change, and `defaults` always knows it.
      }
      locale = preferred ?? macDefaultsLanguage() ?? locale;
    } else if (process.platform === 'win32') {
      const { default: koffi } = await import('koffi');
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
