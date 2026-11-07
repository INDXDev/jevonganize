/** Config, keys, and the checks and actions that touch this machine. */
import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { optionalTools } from '../../extract/index.ts';
import type { Check, KeyList, ProviderName } from '../../types.ts';
import { type Config, configJsonSchema, locations, saveConfig, UserError } from '../config.ts';
import type { Db } from '../db.ts';
import { systemLanguage } from '../system-language.ts';
import {
  envKeysAllowed,
  KEY_ENV,
  keySource,
  removeApiKey,
  setApiKey,
  setEnvKeysAllowed,
} from '../credentials.ts';
import { openable, openInDefaultApp, reveal } from './file-manager.ts';
import {
  type Context,
  libraries,
  nothing,
  fileId,
  servableFile,
  type ToolTable,
} from './shared.ts';

const providerName = z.enum([
  'openai',
  'typesafe',
  'gateway',
  'cloudflare',
  'openrouter',
  'compatible',
  'chat',
]);

/** Whether the configured provider has a key. A local server may want none, so it always passes. */
async function keyCheck(config: Config): Promise<Check> {
  const { name } = config.provider;
  const source = await keySource(name);
  const isLocal = name === 'compatible' || name === 'chat';
  const detail = source ? `${name} key present (${source})` : `No API key for ${name}`;
  return { name: 'key', ok: source !== null || isLocal, detail };
}

/** One check per library, on whether its volume can store tags. */
async function volumeChecks(db: Db): Promise<Check[]> {
  return (await libraries(db)).map(({ path, taggable }) => ({
    name: 'volume',
    ok: taggable,
    detail: `${path} ${taggable ? 'can' : 'cannot'} store tags`,
  }));
}

/** A note for each optional program that is missing. They only add extraction, so none fails. */
function missingToolChecks(): Check[] {
  const missing = Object.entries(optionalTools()).filter(([, found]) => !found);
  return missing.map(([tool]) => ({
    name: `optional:${tool}`,
    ok: true,
    detail: `${tool} not found: files that need it get less extraction`,
  }));
}

async function doctor({ db, config }: Context): Promise<Check[]> {
  const runtime = { name: 'runtime', ok: true, detail: `Node.js ${process.versions.node}` };
  return [runtime, await keyCheck(config), ...(await volumeChecks(db)), ...missingToolChecks()];
}

/** Where each provider's key comes from. Only the source is read, never the key. */
async function listKeys(): Promise<KeyList> {
  const providers = Object.keys(KEY_ENV) as ProviderName[];
  const keys = await Promise.all(
    providers.map(async (provider) => ({
      provider,
      source: await keySource(provider),
      in_env: Boolean(process.env[KEY_ENV[provider]]),
    })),
  );
  return { keys, env_allowed: (await envKeysAllowed()) ?? null };
}

/** The file behind an id, if it may be served. Every refusal reads the same, so none says why. */
function requireServableFile(ctx: Context, id: number) {
  const file = servableFile(ctx, id);
  if (!file) throw new UserError(`File ${id} is not in a library`);
  return file;
}

/** Opens a file in its default app, after checking at this moment that it is a file that reads. */
async function openFile(ctx: Context, id: number): Promise<void> {
  const file = requireServableFile(ctx, id);
  // Checked now, not at scan time: a link planted since then would open what it points to.
  const info = await lstat(file.path).catch(() => undefined);
  if (!info?.isFile()) throw new UserError(`File ${id} is not in a library`);
  if (!openable(file.path, info.mode, file.mime)) {
    throw new UserError('This file could run a program, so it was not opened. Reveal it instead');
  }
  await openInDefaultApp(file.path);
}

/** The tools on settings and the machine. */
export const settingsTools = {
  get_config: {
    description: 'The config and its JSON Schema.',
    input: nothing,
    writes: false,
    agent: false,
    run: async (_input, { config }) => ({
      config,
      system_language: await systemLanguage(),
      schema: configJsonSchema(),
      paths: locations(),
    }),
  },

  set_config: {
    description: 'Validates and saves part of the config.',
    input: z.record(z.string(), z.unknown()),
    writes: true,
    agent: false,
    run: async (change, ctx) => {
      Object.assign(ctx.config, await saveConfig(change));
      return ctx.config;
    },
  },

  list_keys: {
    description: 'Each provider and where its key comes from. Never the keys.',
    input: nothing,
    writes: false,
    agent: false,
    run: async () => listKeys(),
  },

  set_api_key: {
    description: 'Stores an API key.',
    input: z.strictObject({ provider: providerName, key: z.string().min(1) }),
    writes: true,
    agent: false,
    run: async ({ provider, key }) => setApiKey(provider, key),
  },

  remove_api_key: {
    description: 'Deletes a stored API key.',
    input: z.strictObject({ provider: providerName }),
    writes: true,
    agent: false,
    run: async ({ provider }) => ({ removed: await removeApiKey(provider) }),
  },

  set_env_keys: {
    description: 'Allows or refuses API keys from the environment.',
    input: z.strictObject({ allowed: z.boolean() }),
    writes: true,
    agent: false,
    run: async ({ allowed }) => setEnvKeysAllowed(allowed),
  },

  reveal_file: {
    description: 'Shows a file in the file manager.',
    input: z.strictObject({ id: fileId }),
    writes: false,
    agent: false,
    run: async ({ id }, ctx) => reveal(requireServableFile(ctx, id).path),
  },

  open_file: {
    description: 'Opens a file in its default app, unless it is an executable.',
    input: z.strictObject({ id: fileId }),
    writes: false,
    agent: false,
    run: async ({ id }, ctx) => openFile(ctx, id),
  },

  doctor: {
    description: 'Checks the runtime, the key, each volume and optional tools.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, ctx) => doctor(ctx),
  },
} satisfies Partial<ToolTable>;
