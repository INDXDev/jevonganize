/** Terminal translations, scoped to an invocation so concurrent callers cannot change its language. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Language } from '../../types.ts';
import { messages as base } from './messages.ts';
import { refreshMessages } from './refresh.ts';
import { tagTreeMessages } from './tag-tree.ts';

const messages = { ...base, ...refreshMessages, ...tagTreeMessages };

type Key = keyof typeof messages;
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never;
type Values<K extends Key> = [Placeholders<K>] extends [never]
  ? []
  : [values: Record<Placeholders<K>, string | number>];
const language = new AsyncLocalStorage<Language>();

/** Runs one command tree with a fixed display language. */
export const withLanguage = <T>(locale: Language, work: () => T): T => language.run(locale, work);

/** The display language of this CLI invocation. */
export const getLanguage = (): Language => language.getStore() ?? 'en';

/** Formats an application-owned message; interpolated user data is never looked up as a key. */
export function t<K extends Key>(key: K, ...args: Values<K>): string {
  const locale = getLanguage();
  const template = locale === 'en' ? key : messages[key][locale === 'ja' ? 0 : 1];
  const values = args[0] as Record<string, string | number> | undefined;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match));
}

/** Human-facing status labels; the machine-readable values never change. */
export const statusLabel = (
  status:
    | 'new'
    | 'organized'
    | 'failed'
    | 'proposed'
    | 'applying'
    | 'applied'
    | 'undone'
    | 'cancelled'
    | 'running'
    | 'done',
) => t(status);

/** Describes a key's source without displaying the key. */
export const keySourceLabel = (source: 'file' | 'env' | null) => t(source ?? 'none');
