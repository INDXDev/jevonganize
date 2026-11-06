/** Decides which paths are never looked at: secrets, the app's own folders, and `exclude`. */
import { dirname, parse, relative, sep } from 'node:path';
import ignore from 'ignore';
import { type Config, paths } from './config.ts';

/**
 * Never read, indexed, tagged or sent, whatever `exclude` says: see docs/security.md. Patterns with
 * an inner `/` need the `**` prefix, or `ignore` anchors them to the root of the path.
 */
const SECRETS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.p12',
  '*.pfx',
  '.ssh/',
  'id_rsa*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.gnupg/',
  '.aws/',
  '*.keychain',
  '*.keychain-db',
  '**/Library/Keychains/',
  '*.kdbx',
  'wallet.dat',
  '**/Library/Application Support/Google/Chrome/',
  '**/Library/Application Support/Microsoft Edge/',
  '**/Library/Application Support/Firefox/',
  '**/.config/google-chrome/',
  '**/.config/microsoft-edge/',
  '**/.mozilla/firefox/',
  '**/AppData/Local/Google/Chrome/User Data/',
  '**/AppData/Local/Microsoft/Edge/User Data/',
  '**/AppData/Roaming/Mozilla/Firefox/',
  '.jevonganize-probe-*', // left by `supported()` if it dies mid-probe
];

export type Excluded = (path: string, directory: boolean) => boolean;

/** A path as `ignore` wants it: `/` separators, and a trailing one on a folder. */
const matcherPath = (path: string, directory: boolean) =>
  path.split(sep).join('/') + (directory ? '/' : '');

/** Builds the exclusion test for a library. Secrets match the whole path, so a root can't hide them. */
export function exclusions(config: Config, root: string): Excluded {
  const secrets = ignore().add(SECRETS);
  const user = ignore().add(config.exclude);
  // With a home folder as a library, these would index the keys, and the index would chase itself.
  const appDirs = [paths.configDir(), dirname(paths.database()), dirname(paths.thumbnails())];
  const isAppPath = (path: string) =>
    appDirs.some((dir) => path === dir || path.startsWith(dir + sep));
  return (path, directory) => {
    if (isAppPath(path)) return true;
    const wholePath = matcherPath(path.slice(parse(path).root.length), directory);
    // A path the matcher cannot judge is not one to read.
    if (!ignore.isPathValid(wholePath)) return true;
    if (secrets.ignores(wholePath)) return true;
    const inRoot = relative(root, path);
    return inRoot !== '' && user.ignores(matcherPath(inRoot, directory));
  };
}

/** True when a library's real path is itself a secret, whatever link led there. */
export function secretRoot(config: Config, real: string): boolean {
  return real !== parse(real).root && exclusions(config, real)(real, true);
}
