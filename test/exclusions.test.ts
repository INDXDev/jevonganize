import { join, parse, relative, sep } from 'node:path';
import ignore from 'ignore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configSchema, paths } from '../src/core/config.ts';
import { exclusions, SECRETS, sharedExclusions } from '../src/core/exclusions.ts';

/**
 * The whole-path judgement `exclusions` must keep giving: every part of it, on every call. Windows
 * separators and drive roots are compared when CI runs this on Windows.
 */
const form = (path: string, directory: boolean) =>
  path.split(sep).join('/') + (directory ? '/' : '');

function reference(exclude: string[], root: string) {
  const secrets = ignore().add(SECRETS);
  const user = ignore().add(exclude);
  return (path: string, directory: boolean) => {
    const whole = form(path.slice(parse(path).root.length), directory);
    if (secrets.ignores(whole)) return true;
    const inRoot = relative(root, path);
    return inRoot !== '' && user.ignores(form(inRoot, directory));
  };
}

const root = join(parse(process.cwd()).root, 'home', 'me', 'library');
const under = (...parts: string[]) => join(root, ...parts);

const NAMES = [
  '.env',
  '.ENV',
  '.env.local',
  '.envrc',
  'env',
  'key.pem',
  'KEY.PEM',
  'key.pem.txt',
  'a.p12',
  'a.pfx',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'my_id_rsa',
  'login.keychain',
  'login.keychain-db',
  'vault.kdbx',
  'wallet.dat',
  'wallet.dat.bak',
  '.jevonganize-probe-1',
  '.ssh',
  '.aws',
  '.gnupg',
  'Chrome',
  'Keychains',
  'notes.txt',
  'with space.pdf',
  'back\\slash.txt',
  '[x].txt',
  '!bang',
  '#hash',
  'ファイル.pdf',
  'node_modules',
  '.DS_Store',
  '._x',
  'a.tmp',
  '\x1b]0;pwned\x07',
];

const FOLDERS = [
  [],
  ['docs'],
  ['docs', 'deep', 'er'],
  ['.ssh'],
  ['.ssh', 'sub'],
  ['x', '.ssh', 'sub'],
  ['.SSH'],
  ['.aws'],
  ['.gnupg', 'private'],
  ['a.pem'],
  ['a.pem', 'b'],
  ['.env'],
  ['.env.d', 'b'],
  ['wallet.dat'],
  ['Library', 'Keychains'],
  ['x', 'Library', 'Keychains', 'y'],
  ['Library', 'Application Support', 'Google', 'Chrome', 'Default'],
  ['Library', 'Application Support', 'Google'],
  ['.config', 'google-chrome'],
  ['.mozilla', 'firefox', 'profile'],
  ['AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default'],
  ['AppData', 'Roaming', 'Mozilla', 'Firefox'],
  ['node_modules', 'pkg'],
  ['.git', 'objects'],
];

const RULES = [
  [],
  configSchema.parse({}).exclude,
  ['docs/deep', '*.pdf', '!keep.pdf'],
  ['/docs', 'notes.txt'],
  ['*', '!*.txt'],
  // A person cannot bring a secret back, and the matcher must agree.
  ['!.env', '!*.pem', '!.ssh/', '!.ssh/**'],
];

describe('exclusions', () => {
  beforeEach(() => {
    vi.stubEnv('JEVONGANIZE_HOME', join(parse(process.cwd()).root, 'nonexistent-app-home'));
  });

  it.each(RULES.map((exclude) => [exclude]))(
    'agrees with whole-path matching for %j',
    (exclude) => {
      const roots = [root, join(root, '.ssh'), join(root, 'Library', 'Keychains', 'inner')];
      for (const library of roots) {
        const excluded = exclusions(configSchema.parse({ exclude }), library);
        const expected = reference(exclude, library);
        for (const folder of FOLDERS) {
          const dir = join(library, ...folder);
          const folderVerdict = folder.length ? excluded(dir, true) : false;
          expect([dir, folderVerdict]).toEqual([dir, folder.length ? expected(dir, true) : false]);
          for (const name of NAMES) {
            const path = join(dir, name);
            expect([path, excluded(path, false)]).toEqual([path, expected(path, false)]);
            expect([path, excluded(path, true)]).toEqual([path, expected(path, true)]);
          }
        }
      }
    },
  );

  it('gives the same answer when a file is judged before its folder, and after', () => {
    const config = configSchema.parse({ exclude: [] });
    const path = under('.ssh', 'notes.txt');
    expect(exclusions(config, root)(path, false)).toBe(true);
    const warm = exclusions(config, root);
    expect(warm(under('.ssh'), true)).toBe(true);
    expect(warm(path, false)).toBe(true);
    expect(warm(path, false)).toBe(true);
  });

  it('judges a file straight under the filesystem root', () => {
    const top = parse(process.cwd()).root;
    const excluded = exclusions(configSchema.parse({ exclude: [] }), top);
    expect(excluded(join(top, 'notes.txt'), false)).toBe(false);
    expect(excluded(join(top, '.env'), false)).toBe(true);
  });

  it('shares a matcher only for the same rules, as a config is changed in place', () => {
    const config = configSchema.parse({ exclude: [] });
    const path = under('notes.txt');
    expect(sharedExclusions(config, root)).toBe(sharedExclusions(config, root));
    expect(sharedExclusions(config, root)(path, false)).toBe(false);
    Object.assign(config, { exclude: ['notes.txt'] });
    expect(sharedExclusions(config, root)(path, false)).toBe(true);
  });

  it('keeps the app out, whatever a library covers', () => {
    const excluded = exclusions(configSchema.parse({ exclude: [] }), root);
    expect(excluded(paths.configFile(), false)).toBe(true);
    expect(excluded(paths.database(), false)).toBe(true);
  });
});
