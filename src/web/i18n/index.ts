/** Explicit interface translations; file content is never a translation key. */
import { useSyncExternalStore } from 'react';
import type { Language } from '../../types.ts';
import { folders } from './folders.ts';
import { shell } from './shell.ts';
import { views } from './views.ts';

/** A supported display language, after resolving the PC preference. */
export type { Language } from '../../types.ts';

const messages = { ...shell, ...views, ...folders };
type Message = keyof typeof messages;
type Slots<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Slots<Rest>
  : never;
type Arguments<K extends string> = [Slots<K>] extends [never]
  ? []
  : [values: Record<Slots<K>, string | number>];

let language: Language = 'en';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Reads the selected language for callbacks and formatting helpers. */
export const getLanguage = (): Language => language;

/** Follows the saved config without browser detection or local storage. */
export function setLanguage(value: unknown, systemLanguage: Language = 'en'): void {
  const next =
    value === 'system' ? systemLanguage : value === 'ja' || value === 'zh-CN' ? value : 'en';
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}

/** Subscribes a component to language changes, without resetting its state. */
export const useLanguage = (): Language => useSyncExternalStore(subscribe, getLanguage);

/** Translates trusted interface text and interpolates each value once as plain text. */
export function t<K extends Message>(key: K, ...args: Arguments<K>): string {
  const text =
    language === 'en' || !Object.hasOwn(messages, key)
      ? key
      : messages[key][language === 'ja' ? 0 : 1];
  const values = args[0] as Record<string, string | number> | undefined;
  return text.replace(/\{([^{}]+)\}/g, (slot, name: string) =>
    values && Object.hasOwn(values, name) ? String(values[name]) : slot,
  );
}
