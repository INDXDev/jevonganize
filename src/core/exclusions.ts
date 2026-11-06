/** Decides which paths are never looked at: secrets, the app's own folders, and `exclude`. */
import { dirname, parse, relative, sep } from 'node:path';
import ignore from 'ignore';
import { type Config, paths } from './config.ts';

/**
 * Never read, indexed, tagged or sent, whatever `exclude` says: see docs/security.md. Patterns with
 * an inner `/` need the `**` prefix, or `ignore` anchors them to the root of the path.
 */
export const SECRETS = [
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
  // A rule ending in `/` never matches a file, and the others look only at its name. That leaves
  // the folders above a file, which are few and judged once: this runs for every file of a scan.
  const fileSecrets = ignore().add(SECRETS.filter((rule) => !rule.endsWith('/')));
  const user = config.exclude.length > 0 ? ignore().add(config.exclude) : undefined;
  const folders = new Map<string, boolean>();
  const isSecretFolder = (folder: string) => {
    let secret = folders.get(folder);
    if (secret === undefined) folders.set(folder, (secret = secrets.ignores(folder)));
    return secret;
  };
  const isSecret = (wholePath: string) => {
    const name = wholePath.lastIndexOf('/') + 1;
    if (name === wholePath.length) return isSecretFolder(wholePath);
    return (
      (name > 0 && isSecretFolder(wholePath.slice(0, name))) ||
      fileSecrets.ignores(wholePath.slice(name))
    );
  };
  // With a home folder as a library, these would index the keys, and the index would chase itself.
  const appDirs = [paths.configDir(), dirname(paths.database()), dirname(paths.thumbnails())];
  const isAppPath = (path: string) =>
    appDirs.some((dir) => path === dir || path.startsWith(dir + sep));
  return (path, directory) => {
    if (isAppPath(path)) return true;
    const wholePath = matcherPath(path.slice(parse(path).root.length), directory);
    // A path the matcher cannot judge is not one to read.
    if (!ignore.isPathValid(wholePath)) return true;
    if (isSecret(wholePath)) return true;
    if (!user) return false;
    const inRoot = relative(root, path);
    return inRoot !== '' && user.ignores(matcherPath(inRoot, directory));
  };
}

const shared = new Map<string, Excluded>();
const MAX_SHARED = 64;

/**
 * `exclusions`, built once for the same rules. For what asks about one path at a time, like a
 * thumbnail, where building the matchers costs more than the question. Keyed by value, because a
 * config object is changed in place.
 */
export function sharedExclusions(config: Config, root: string): Excluded {
  const key = JSON.stringify([root, config.exclude, paths.configDir(), paths.database()]);
  let excluded = shared.get(key);
  if (!excluded) {
    if (shared.size >= MAX_SHARED) shared.clear();
    shared.set(key, (excluded = exclusions(config, root)));
  }
  return excluded;
}

/** True when a library's real path is itself a secret, whatever link led there. */
export function secretRoot(config: Config, real: string): boolean {
  return real !== parse(real).root && exclusions(config, real)(real, true);
}
