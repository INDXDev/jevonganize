import { execFileSync } from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../src/core/config.ts';
import { readTags, supported, writeTags } from '../src/core/tags.ts';
import { useTempHome } from './helpers.ts';

const home = useTempHome();
let file: string;

beforeEach(async () => {
  file = join(home(), 'file.txt');
  await writeFile(file, 'content');
});

const stream = () => `${file}:jevonganize.tags`;

/** Loads a fresh tags.ts that believes it runs on `platform`. */
async function tagsOn(platform: NodeJS.Platform) {
  vi.resetModules();
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  return await import('../src/core/tags.ts');
}

async function times(path: string) {
  const { mtimeNs, ctimeNs } = await stat(path, { bigint: true });
  return { mtimeNs, ctimeNs };
}
const tick = () => new Promise((done) => setTimeout(done, 20));

/** Reads the raw xattr with another program, so this test does not check tags.ts against itself. */
const READ_XATTR = `import os, sys; sys.stdout.buffer.write(os.getxattr(sys.argv[1], 'user.xdg.tags'))`;

/** Stands in for koffi with an in-memory attribute store, for the length of each test. */
function useFakeLibc() {
  const store = new Map<string, Buffer>();
  const errno = { value: 0 };
  const signatures: string[] = [];

  beforeEach(() => {
    store.clear();
    signatures.length = 0;
    vi.doMock('koffi', () => ({
      default: {
        errno: () => errno.value,
        load: () => {
          return {
            func(signature: string) {
              signatures.push(signature);
              if (signature.includes('removexattr')) {
                return (path: string, attr: string) => {
                  errno.value = 61;
                  return store.delete(`${path}|${attr}`) ? 0 : -1;
                };
              }
              if (signature.includes('setxattr')) {
                return (path: string, attr: string, value: Buffer) => {
                  store.set(`${path}|${attr}`, Buffer.from(value));
                  return 0;
                };
              }
              return (path: string, attr: string, out: Buffer | null) => {
                const value = store.get(`${path}|${attr}`);
                errno.value = 61; // ENODATA
                if (!value) return -1;
                out?.set(value);
                return value.length;
              };
            },
          };
        },
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('koffi');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  return { store, signatures };
}

describe('the linux backend, against a fake libc', () => {
  const { store, signatures } = useFakeLibc();

  it('stores one comma-joined value in user.xdg.tags, without following links', async () => {
    const tags = await tagsOn('linux');
    await tags.writeTags(file, ['b', 'a']);
    expect(store.get(`${file}|user.xdg.tags`)?.toString()).toBe('a,b');
    expect(await tags.readTags(file)).toEqual(['a', 'b']);
    expect(signatures.join()).toContain('lgetxattr');
    expect(signatures.join()).toContain('lsetxattr');
    expect(signatures.join()).toContain('lremovexattr');
  });

  it('reads [] when untagged, and removes the attribute on []', async () => {
    const tags = await tagsOn('linux');
    expect(await tags.readTags(file)).toEqual([]);
    await tags.writeTags(file, ['a']);
    await tags.writeTags(file, []);
    expect(store.size).toBe(0);
    await tags.writeTags(file, []);
    expect(tags.isScreenCapture(file)).toBe(false);
  });
});

describe('the win32 backend: a real stream on Windows, a sibling file elsewhere', () => {
  beforeEach(() => {
    if (process.platform === 'win32') return;
    vi.doMock('koffi', () => ({ default: { load: () => ({ func: () => () => 1 }) } }));
  });

  afterEach(() => {
    vi.doUnmock('koffi');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('stores comma-joined UTF-8, and deletes the stream on []', async () => {
    const tags = await tagsOn('win32');
    await tags.writeTags(file, ['山田', 'a']);
    expect(await readFile(stream(), 'utf8')).toBe('a,山田');
    expect(await tags.readTags(file)).toEqual(['a', '山田']);
    await tags.writeTags(file, []);
    await expect(stat(stream())).rejects.toThrow('ENOENT');
    await tags.writeTags(file, []);
    expect(await tags.readTags(file)).toEqual([]);
  });

  it('throws for a missing file, and refuses a relative path', async () => {
    const tags = await tagsOn('win32');
    await expect(tags.readTags(join(home(), 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(tags.readTags('C')).rejects.toThrow(/absolute/);
  });
});

describe.runIf(process.platform === 'win32')('tags on this Windows volume', () => {
  it('stores, reads and removes a real stream, and leaves the content alone', async () => {
    expect(await supported(home())).toBe(true);
    await writeTags(file, ['山田', 'a']);
    expect(await readFile(stream(), 'utf8')).toBe('a,山田');
    expect(await readTags(file)).toEqual(['a', '山田']);
    expect(await readFile(file, 'utf8')).toBe('content');
    expect((await stat(file)).size).toBe('content'.length);
    await writeTags(file, []);
    await expect(readFile(stream())).rejects.toMatchObject({ code: 'ENOENT' });
    await writeTags(file, []);
    expect(await readTags(file)).toEqual([]);
  });

  it('reads a stream another program wrote', async () => {
    await writeFile(stream(), 'b,a,,a');
    expect(await readTags(file)).toEqual(['a', 'b']);
  });

  it('keeps mtime to the tick on write and removal, and ctime moves', async () => {
    const before = await times(file);
    await tick();
    await writeTags(file, ['a']);
    const written = await times(file);
    expect(written.mtimeNs).toBe(before.mtimeNs);
    expect(written.ctimeNs).toBeGreaterThan(before.ctimeNs);
    await tick();
    await writeTags(file, []);
    const removed = await times(file);
    expect(removed.mtimeNs).toBe(before.mtimeNs);
    expect(removed.ctimeNs).toBeGreaterThan(written.ctimeNs);
  });

  it('works past MAX_PATH', async () => {
    const dir = join(home(), ...Array.from({ length: 6 }, () => 'd'.repeat(50)));
    await mkdir(dir, { recursive: true });
    const deep = join(dir, 'file.txt');
    await writeFile(deep, 'content');
    const before = await times(deep);
    await writeTags(deep, ['a']);
    expect(await readTags(deep)).toEqual(['a']);
    expect((await times(deep)).mtimeNs).toBe(before.mtimeNs);
  });

  it('moves mtime on a raw stream write and not on a raw removal, as docs/tags.md says', async () => {
    const before = await times(file);
    await tick();
    await writeFile(stream(), 'a');
    const written = await times(file);
    expect(written.mtimeNs).toBeGreaterThan(before.mtimeNs);
    await tick();
    await unlink(stream());
    const removed = await times(file);
    expect(removed.mtimeNs).toBe(written.mtimeNs);
    expect(removed.ctimeNs).toBeGreaterThan(written.ctimeNs);
  });
});

describe.runIf(process.platform === 'win32')(
  'keeping tags through copies and saves on this Windows volume',
  () => {
    it('keeps tags through a rename and Node copies', async () => {
      await writeTags(file, ['a']);
      const moved = join(home(), 'moved.txt');
      await rename(file, moved);
      expect(await readTags(moved)).toEqual(['a']);
      const copied = join(home(), 'copied.txt');
      await copyFile(moved, copied);
      expect(await readTags(copied)).toEqual(['a']);
      const recursive = join(home(), 'recursive.txt');
      await cp(moved, recursive);
      expect(await readTags(recursive)).toEqual(['a']);
    });

    it('keeps tags through a save in place, and loses them to an overwrite or a rename over', async () => {
      await writeTags(file, ['a']);
      const handle = await open(file, 'r+');
      await handle.write('X', 0);
      await handle.close();
      expect(await readTags(file)).toEqual(['a']);
      const { ino } = await stat(file, { bigint: true });
      await writeFile(file, 'saved over');
      expect(await readTags(file)).toEqual([]);
      expect((await stat(file, { bigint: true })).ino).toBe(ino);
      await writeTags(file, ['a']);
      await writeFile(`${file}.new`, 'saved');
      await rename(`${file}.new`, file);
      expect(await readTags(file)).toEqual([]);
    });

    it('does not follow a symlink', async () => {
      const link = join(home(), 'link');
      await symlink(file, link);
      await expect(writeTags(link, ['a'])).rejects.toBeInstanceOf(UserError);
      expect(await readTags(file)).toEqual([]);
    });

    it('throws for a missing file rather than reading it as untagged', async () => {
      await unlink(file);
      await expect(readTags(file)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  },
);

describe.runIf(process.platform === 'linux')('tags on this Linux volume', () => {
  it('stores, reads and removes the xattr, with mtime kept and ctime moved', async () => {
    expect(await supported(home())).toBe(true);
    const before = await times(file);
    await tick();
    await writeTags(file, ['山田', 'a']);
    const written = await times(file);
    expect(execFileSync('python3', ['-c', READ_XATTR, file]).toString()).toBe('a,山田');
    expect(await readTags(file)).toEqual(['a', '山田']);
    expect(written.mtimeNs).toBe(before.mtimeNs);
    expect(written.ctimeNs).toBeGreaterThan(before.ctimeNs);
    await writeTags(file, []);
    expect(await readTags(file)).toEqual([]);
    expect(() => execFileSync('python3', ['-c', READ_XATTR, file], { stdio: 'ignore' })).toThrow(
      'Command failed',
    );
  });
});
