/** Where everything lives, and reaching it. Apart from the schema, so startup and workers skip zod. */
import { join } from 'node:path';
import envPaths from 'env-paths';

const defaultDirs = envPaths('jevonganize', { suffix: '' });

function homeOverride(kind: string): string | undefined {
  const root = process.env.JEVONGANIZE_HOME;
  return root ? join(root, kind) : undefined;
}

const cacheDir = () => homeOverride('cache') ?? defaultDirs.cache;

/** Tests point these elsewhere with `JEVONGANIZE_HOME`. */
export const paths = {
  configDir: () => homeOverride('config') ?? defaultDirs.config,
  configFile: () => join(paths.configDir(), 'config.toml'),
  credentialsFile: () => join(paths.configDir(), 'credentials.toml'),
  facetsDir: () => join(paths.configDir(), 'facets'),
  database: () => join(homeOverride('data') ?? defaultDirs.data, 'index.db'),
  thumbnails: () => join(cacheDir(), 'thumbnails'),
  compileCache: () => join(cacheDir(), 'compile'),
};

/** Awaits a file operation, turning "no such file" into `undefined`. */
export async function ifExists<T>(operation: Promise<T>): Promise<T | undefined> {
  try {
    return await operation;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
