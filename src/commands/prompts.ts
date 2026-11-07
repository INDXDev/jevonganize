/** Questions a command asks in a terminal. They write to stderr, so stdout keeps only results. */
import { t } from './i18n/index.ts';
import { confirm, isCancel, password } from '@clack/prompts';
import { envKeyUnanswered, KEY_ENV, setEnvKeysAllowed } from '../core/credentials.ts';
import type { ProviderName } from '../types.ts';

/** Options every prompt shares. */
export const promptOutput = { output: process.stderr };

/** Asks once, in a terminal, whether a key in the environment may be used. The default is no. */
export async function askEnvConsent(provider: ProviderName): Promise<void> {
  if (!process.stdin.isTTY || !(await envKeyUnanswered(provider))) return;
  const answer = await confirm({
    ...promptOutput,
    message: t('{key} is set. Use keys from the environment?', { key: KEY_ENV[provider] }),
    initialValue: false,
    active: t('Yes'),
    inactive: t('No'),
  });
  await setEnvKeysAllowed(answer === true);
}

/** Reads a key: hidden in a terminal, and from stdin in a pipe, so it never lands in shell history. */
export async function readKey(label: string): Promise<string> {
  if (process.stdin.isTTY) {
    const value = await password({ ...promptOutput, message: label });
    return isCancel(value) ? '' : value;
  }
  let piped = '';
  for await (const chunk of process.stdin) piped += String(chunk);
  return piped.trim();
}
