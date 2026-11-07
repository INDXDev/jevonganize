/** Config, keys, and the checks and actions that touch this machine. */
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
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

/**
 * `explorer` splits an unquoted path at commas, and Node quotes only for spaces, so paths for it are
 * quoted by hand. A Windows name cannot hold a `"`, so nothing can break out. Other OSes ignore this.
 */
const DETACHED = { detached: true, stdio: 'ignore', windowsVerbatimArguments: true } as const;

/** Shows a file in the file manager, for files `open_file` refuses too. */
function reveal(path: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', ['-R', path]]
      : process.platform === 'win32'
        ? ['explorer', [`/select,"${path}"`]]
        : ['xdg-open', [dirname(path)]];
  const child = spawn(command, args, DETACHED);
  child.on('error', () => {}); // no file manager to show it in, and nothing for the caller to do
  child.unref();
}

/** What the OS would run, install or follow rather than read. Add to this, never remove from it. */
const RUNS = new Set(
  `action app appimage applescript application appref-ms appx appxbundle bash bat bin caction cgi chm
  cmd com command cpl csh deb desktop diagcab diagcfg diagpkg dll dmg dylib elf exe fileloc fish
  gadget hlp hta iaddress img inetloc inf ins iso isp its jar jnlp js jse ksh ldb library-ms lnk mcf mpkg
  msc msh msi msix msixbundle msp mst mysqld ocx osax out paf pif pkg pl plugin prefpane prg ps1
  ps1xml ps2 ps2xml psc1 psc2 psd1 psm1 py pyc pyo pyw pyz rb reg rgs rpm run scf scpt scptd scr
  sct search-ms searchconnector-ms service settingcontent-ms sh shb shs shortcut so sys terminal
  tool u3p url vb vbe vbs vbscript vhd vhdx vsix webloc website wflow workflow ws wsc wsf wsh xbap xll xpi
  zsh`.split(/\s+/),
);

/** Types no OS runs. Contents decide this one, for the check on the execute bit. */
const DOCUMENT =
  /^(image|audio|video)\/|pdf$|officedocument|opendocument|msword|ms-(excel|powerpoint)/;

/** Whether the OS would read this file, not run it. It chooses by name, so the name decides. */
function openable(path: string, mode: number, mime: string | null): boolean {
  // Windows drops trailing dots and spaces, so `a.exe.` is `a.exe`.
  const extension = extname(path.replace(/[. ]+$/, ''))
    .slice(1)
    .toLowerCase();
  // macOS can run such a file in Terminal. exFAT and network drives set the bit on every file, so
  // a real document is let through.
  const executable =
    process.platform !== 'win32' && (mode & 0o111) !== 0 && !DOCUMENT.test(mime ?? '');
  return !!extension && !RUNS.has(extension) && !executable;
}

/** Opens a file in its default app. Only ever from a person's click, see docs/security.md. */
async function openInDefaultApp(path: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [path]]
      : process.platform === 'win32'
        ? ['explorer', [`"${path}"`]]
        : ['xdg-open', [path]];
  const child = spawn(command, args, DETACHED);
  const code = await new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('exit', resolve);
  });
  // `explorer` exits with 1 even when the file opened, so only a failure to start says anything.
  if (code === null || (code !== 0 && process.platform !== 'win32')) {
    throw new UserError('No app could open this file');
  }
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
          in_env: Boolean(process.env[KEY_ENV[provider]]),
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

  open_file: {
    description: 'Opens a file in its default app, unless it is an executable.',
    input: z.strictObject({ id: fileId }),
    writes: false,
    agent: false,
    run: async ({ id }, ctx) => {
      const file = servableFile(ctx, id);
      if (!file) throw new UserError(`File ${id} is not in a library`);
      // Checked now, not at scan time: a link planted since then would open what it points to.
      const info = await lstat(file.path).catch(() => undefined);
      if (!info?.isFile()) throw new UserError(`File ${id} is not in a library`);
      if (!openable(file.path, info.mode, file.mime)) {
        throw new UserError(
          'This file could run a program, so it was not opened. Reveal it instead',
        );
      }
      await openInDefaultApp(file.path);
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
