/** API keys: the user's 0600 credentials file, and the environment once the user allows it. */
import { chmod, mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { stringify } from 'smol-toml';
import { z } from 'zod';
import type { ProviderName } from '../types.ts';
import {
  ifExists,
  parseToml,
  parseWith,
  paths,
  readRegularFile,
  UserError,
  writeFileAtomic,
} from './config.ts';

/** The environment variable holding each provider's key. */
export const KEY_ENV: Record<ProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  typesafe: 'TYPESAFE_AI_API_KEY',
  gateway: 'AI_GATEWAY_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
  openrouter: 'OPENROUTER_API_KEY',
  compatible: 'JEVONGANIZE_API_KEY',
  chat: 'JEVONGANIZE_CHAT_API_KEY',
};

/** Lives beside the keys, in a user-only file, so nothing in a config file can turn it on. */
const USE_ENV = 'use_env';
const LOCK_WAIT_MS = 5000;
/** A lock this old belongs to a process that died. Holders keep it for milliseconds. */
const LOCK_STALE_MS = 30_000;

const keysSchema = z.record(z.string(), z.string());
type Keys = z.infer<typeof keysSchema>;

async function readKeys(): Promise<Keys> {
  const file = paths.credentialsFile();
  const text = await ifExists(readRegularFile(file));
  return text === undefined ? {} : parseWith(keysSchema, parseToml(text, file), file);
}

async function takeLock(lock: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await (await open(lock, 'wx', 0o600)).close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const held = await ifExists(stat(lock));
    if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) await rm(lock, { force: true });
    else if (Date.now() > deadline) {
      throw new UserError(`${lock} is held by another process. Delete it if none is running`);
    } else await sleep(20);
  }
}

/** Read, modify and write under a lock, since the CLI and the server share this file. */
async function updateKeys(change: (keys: Keys) => Keys): Promise<void> {
  const file = paths.credentialsFile();
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700); // mkdir leaves the mode of an existing directory alone
  const lock = `${file}.lock`;
  await takeLock(lock);
  try {
    await writeFileAtomic(file, stringify(change(await readKeys())), 0o600);
  } finally {
    await rm(lock, { force: true });
  }
}

const envKey = (keys: Keys, provider: ProviderName) =>
  keys[USE_ENV] === 'yes' ? process.env[KEY_ENV[provider]] : undefined;

/** Returns the key for a provider, if one is set. Allowed environment keys take priority. */
export async function getApiKey(provider: ProviderName): Promise<string | undefined> {
  const keys = await readKeys();
  return envKey(keys, provider) || keys[provider];
}

/**
 * Returns the key for exactly this provider, or refuses. Never substitutes another provider's key,
 * because that would send files somewhere the user did not choose.
 */
export async function requireApiKey(provider: ProviderName): Promise<string> {
  const key = await getApiKey(provider);
  if (key) return key;
  const hint = (await envKeyUnanswered(provider))
    ? `${KEY_ENV[provider]} is set, but environment keys are off. Run: jevonganize auth env on`
    : `Run: jevonganize auth set ${provider}`;
  throw new UserError(`No API key for provider "${provider}". ${hint}`);
}

/** Says where a provider's key comes from, without exposing it. */
export async function keySource(provider: ProviderName): Promise<'env' | 'file' | null> {
  const keys = await readKeys();
  if (envKey(keys, provider)) return 'env';
  return keys[provider] ? 'file' : null;
}

/** Says whether the user allowed keys from the environment, or `undefined` if never asked. */
export async function envKeysAllowed(): Promise<boolean | undefined> {
  const choice = (await readKeys())[USE_ENV];
  return choice === undefined ? undefined : choice === 'yes';
}

/** True when an interactive run should ask: a key is in the environment and nobody has answered. */
export async function envKeyUnanswered(provider: ProviderName): Promise<boolean> {
  return Boolean(process.env[KEY_ENV[provider]]) && (await envKeysAllowed()) === undefined;
}

/** Records whether keys may come from the environment. */
export async function setEnvKeysAllowed(allowed: boolean): Promise<void> {
  await updateKeys((keys) => ({ ...keys, [USE_ENV]: allowed ? 'yes' : 'no' }));
}

/** Stores a key, keeping those of other providers. */
export async function setApiKey(provider: ProviderName, key: string): Promise<void> {
  const trimmed = key.trim(); // a pasted key often brings a newline
  if (!trimmed) throw new UserError('The API key is empty');
  await updateKeys((keys) => ({ ...keys, [provider]: trimmed }));
}

/** Deletes a stored key, returning whether there was one. */
export async function removeApiKey(provider: ProviderName): Promise<boolean> {
  let found = false;
  await updateKeys(({ [provider]: removed, ...others }) => {
    found = removed !== undefined;
    return others;
  });
  return found;
}
