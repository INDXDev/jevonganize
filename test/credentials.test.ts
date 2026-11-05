import { chmod, lstat, mkdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { paths, UserError } from '../src/core/config.ts';
import {
  envKeysAllowed,
  envKeyUnanswered,
  getApiKey,
  keySource,
  removeApiKey,
  requireApiKey,
  setApiKey,
  setEnvKeysAllowed,
} from '../src/core/credentials.ts';
import { useTempHome } from './helpers.ts';

const home = useTempHome();
const mode = async (path: string) => (await stat(path)).mode & 0o777;

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe('the credentials file', () => {
  it('stores keys in a 0600 file inside a 0700 directory', async () => {
    await setApiKey('openai', ' sk-one\n');
    expect(await getApiKey('openai')).toBe('sk-one');
    if (process.platform === 'win32') return; // POSIX modes do not exist there. See docs/security.md
    expect(await mode(paths.credentialsFile())).toBe(0o600);
    expect(await mode(paths.configDir())).toBe(0o700);
  });

  // POSIX modes do not exist on Windows, where `chmod` sets only the read-only attribute.
  it.skipIf(process.platform === 'win32')(
    'reapplies the modes when they have loosened',
    async () => {
      await setApiKey('openai', 'one');
      await chmod(paths.credentialsFile(), 0o644);
      await chmod(paths.configDir(), 0o755);
      await setApiKey('typesafe', 'two');
      expect(await mode(paths.credentialsFile())).toBe(0o600);
      expect(await mode(paths.configDir())).toBe(0o700);
    },
  );

  it('replaces a planted symlink rather than writing through it', async () => {
    const target = join(home(), 'target');
    await writeFile(target, '# untouched\n');
    await mkdir(paths.configDir(), { recursive: true });
    await symlink(target, paths.credentialsFile());
    await setApiKey('openai', 'one');
    expect(await readFile(target, 'utf8')).toBe('# untouched\n');
    expect((await lstat(paths.credentialsFile())).isFile()).toBe(true);
  });

  it('keeps every key under concurrent writers', async () => {
    const names = [
      'openai',
      'typesafe',
      'gateway',
      'cloudflare',
      'openrouter',
      'compatible',
    ] as const;
    await Promise.all(names.map((name) => setApiKey(name, `key-${name}`)));
    for (const name of names) expect(await getApiKey(name)).toBe(`key-${name}`);
    await expect(stat(`${paths.credentialsFile()}.lock`)).rejects.toThrow('ENOENT');
  });

  it('breaks a stale lock', async () => {
    const lock = `${paths.credentialsFile()}.lock`;
    await mkdir(dirname(lock), { recursive: true });
    await writeFile(lock, '');
    await utimes(lock, new Date(0), new Date(0));
    await setApiKey('openai', 'one');
    expect(await getApiKey('openai')).toBe('one');
  });

  it('removes one key and reports whether it was there', async () => {
    await setApiKey('openai', 'one');
    await setApiKey('typesafe', 'two');
    expect(await removeApiKey('openai')).toBe(true);
    expect(await removeApiKey('openai')).toBe(false);
    expect(await getApiKey('openai')).toBeUndefined();
    expect(await getApiKey('typesafe')).toBe('two');
  });

  it('refuses an empty key', async () => {
    await expect(setApiKey('openai', '  \n')).rejects.toThrow(UserError);
  });

  it('does not quote a damaged file in its error', async () => {
    await mkdir(paths.configDir(), { recursive: true });
    await writeFile(paths.credentialsFile(), 'openai = sk-secret-value\n');
    const error = await getApiKey('openai').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UserError);
    expect((error as Error).message).not.toContain('sk-secret-value');
  });
});

describe('environment keys', () => {
  it('ignores them until allowed, then prefers them', async () => {
    process.env.OPENAI_API_KEY = 'from-env';
    await setApiKey('openai', 'from-file');
    expect(await getApiKey('openai')).toBe('from-file');
    expect(await keySource('openai')).toBe('file');
    await setEnvKeysAllowed(true);
    expect(await getApiKey('openai')).toBe('from-env');
    expect(await keySource('openai')).toBe('env');
    await setEnvKeysAllowed(false);
    expect(await getApiKey('openai')).toBe('from-file');
  });

  it('tracks whether the question was answered', async () => {
    expect(await envKeysAllowed()).toBeUndefined();
    expect(await envKeyUnanswered('openai')).toBe(false);
    process.env.OPENAI_API_KEY = 'from-env';
    expect(await envKeyUnanswered('openai')).toBe(true);
    await setEnvKeysAllowed(false);
    expect(await envKeysAllowed()).toBe(false);
    expect(await envKeyUnanswered('openai')).toBe(false);
  });
});

describe('requireApiKey', () => {
  it('returns the key of exactly that provider', async () => {
    await setApiKey('openai', 'one');
    expect(await requireApiKey('openai')).toBe('one');
  });

  it('refuses rather than use another provider', async () => {
    await setApiKey('typesafe', 'held-for-another');
    const error = await requireApiKey('openai').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UserError);
    expect((error as Error).message).toContain('auth set openai');
    expect((error as Error).message).not.toContain('held-for-another');
  });

  it('refuses an unanswered environment key, and says how to allow it', async () => {
    process.env.OPENAI_API_KEY = 'from-env';
    await expect(requireApiKey('openai')).rejects.toThrow('auth env on');
  });
});
