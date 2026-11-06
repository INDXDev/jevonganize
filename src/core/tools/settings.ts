/** Config, keys, and the checks and actions that touch this machine. */
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { z } from 'zod';
import { optionalTools } from '../../extract/index.ts';
import type { Check, ProviderName } from '../../types.ts';
import { configJsonSchema, locations, saveConfig, UserError } from '../config.ts';
import { systemLanguage } from '../system-language.ts';
import {
  envKeysAllowed,
  KEY_ENV,
  keySource,
  removeApiKey,
  setApiKey,
  setEnvKeysAllowed,
} from '../credentials.ts';
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

async function doctor({ db, config }: Context): Promise<Check[]> {
  const { name } = config.provider;
  const source = await keySource(name);
  const local = name === 'compatible' || name === 'chat'; // a local server may want no key
  const checks: Check[] = [
    { name: 'runtime', ok: true, detail: `Node.js ${process.versions.node}` },
    {
      name: 'key',
      ok: source !== null || local,
      detail: source ? `${name} key present (${source})` : `No API key for ${name}`,
    },
  ];
  for (const { path, taggable: ok } of await libraries(db)) {
    const detail = `${path} ${ok ? 'can' : 'cannot'} store tags`;
    checks.push({ name: 'volume', ok, detail });
  }
  for (const [tool, found] of Object.entries(optionalTools())) {
    if (!found) {
      const detail = `${tool} not found: files that need it get less extraction`;
      checks.push({ name: `optional:${tool}`, ok: true, detail });
    }
  }
  return checks;
}

/** Shows a file in the file manager. Never opens it: that could run it. */
function reveal(path: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', ['-R', path]]
      : process.platform === 'win32'
        ? ['explorer', [`/select,${path}`]]
        : ['xdg-open', [dirname(path)]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // no file manager to show it in, and nothing for the caller to do
  child.unref();
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
    run: async () => ({
      keys: await Promise.all(
        (Object.keys(KEY_ENV) as ProviderName[]).map(async (provider) => ({
          provider,
          source: await keySource(provider),
        })),
      ),
      env_allowed: (await envKeysAllowed()) ?? null,
    }),
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
    run: async ({ id }, ctx) => {
      const file = servableFile(ctx, id);
      if (!file) throw new UserError(`File ${id} is not in a library`);
      reveal(file.path);
    },
  },

  doctor: {
    description: 'Checks the runtime, the key, each volume and optional tools.',
    input: nothing,
    writes: false,
    agent: true,
    run: async (_input, ctx) => doctor(ctx),
  },
} satisfies Partial<ToolTable>;
