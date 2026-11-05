import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bplist from 'bplist-creator';
import { UserError } from '../src/core/config.ts';
import { isScreenCapture, normalize, readTags, supported, writeTags } from '../src/core/tags.ts';
import { useTempHome } from './helpers.ts';

const USER_TAGS = 'com.apple.metadata:_kMDItemUserTags';
const home = useTempHome();
let file: string;

/** Writes an xattr with the system tool, so tests do not check tags.ts against itself. */
const setXattr = (path: string, name: string, value: Buffer) =>
  execFileSync('xattr', ['-wx', name, value.toString('hex'), path]);
const getXattr = (path: string, name: string) =>
  Buffer.from(execFileSync('xattr', ['-px', name, path]).toString().replace(/\s/g, ''), 'hex');

beforeEach(async () => {
  file = join(home(), 'file.txt');
  await writeFile(file, 'content');
});

describe('normalize', () => {
  it('applies NFC, trims, drops empties and sorts by code unit', () => {
    expect(normalize([' b ', 'café', '', 'B2', 'a'])).toEqual(['B2', 'a', 'b', 'café']);
  });

  it('is unique ignoring case, and the first spelling wins', () => {
    expect(normalize(['Upper', 'upper', 'UPPER'])).toEqual(['Upper']);
  });
});

describe.runIf(process.platform === 'darwin')('tags on this macOS volume', () => {
  it('round-trips, including CJK, emoji and hierarchy', async () => {
    const tags = ['party:山田商事', 'topic:finance/tax', '👩‍💻', 'year/2024', 'a:b:c'];
    await writeTags(file, tags);
    expect(await readTags(file)).toEqual(normalize(tags));
  });

  it('reads [] when untagged, and [] after clearing', async () => {
    expect(await readTags(file)).toEqual([]);
    await writeTags(file, ['a']);
    await writeTags(file, []);
    expect(await readTags(file)).toEqual([]);
    expect(() => execFileSync('xattr', ['-p', USER_TAGS, file], { stdio: 'ignore' })).toThrow(
      'xattr',
    );
    await writeTags(file, []); // clearing nothing is fine
  });

  it('throws ENOENT for a missing file', async () => {
    const missing = join(home(), 'missing');
    await expect(readTags(missing)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(writeTags(missing, ['a'])).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves mtime and content alone, and moves ctime', async () => {
    const before = await stat(file, { bigint: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeTags(file, ['a']);
    const after = await stat(file, { bigint: true });
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ctimeNs).not.toBe(before.ctimeNs);
    expect(await readFile(file, 'utf8')).toBe('content');
  });

  it('keeps Finder colours for tags that stay', async () => {
    setXattr(file, USER_TAGS, bplist(['red\n6', 'plain']));
    expect(await readTags(file)).toEqual(['plain', 'red']);
    await writeTags(file, ['new', 'red']);
    const raw = getXattr(file, USER_TAGS).toString('latin1');
    expect(raw).toContain('red\n6');
    expect(raw).toContain('new\n0');
  });

  it('reads NFD from disk as NFC', async () => {
    setXattr(file, USER_TAGS, bplist(['café']));
    expect(await readTags(file)).toEqual(['café']);
  });

  it('reads the legacy colour, and clears only the colour bits on write', async () => {
    const info = Buffer.alloc(32);
    info[0] = 0x41;
    info[9] = (6 << 1) | 0x01;
    setXattr(file, 'com.apple.FinderInfo', info);
    expect(await readTags(file)).toEqual(['Red']);
    await writeTags(file, ['a']);
    const after = getXattr(file, 'com.apple.FinderInfo');
    expect(after[0]).toBe(0x41);
    expect(after[9]).toBe(0x01);
    await writeTags(file, []);
    expect(await readTags(file)).toEqual([]);
  });

  it('refuses a damaged attribute rather than overwrite it', async () => {
    setXattr(file, USER_TAGS, Buffer.from('not a plist'));
    await expect(readTags(file)).rejects.toThrow('bplist');
    await expect(writeTags(file, ['a'])).rejects.toThrow('bplist');
    setXattr(file, USER_TAGS, bplist({ not: 'a list' }));
    await expect(readTags(file)).rejects.toThrow('not a list');
  });

  it('rejects a bad set and leaves the old tags', async () => {
    await writeTags(file, ['kept']);
    for (const bad of ['a,b', 'a;b', 'a"b', 'a\\b', 'a*b', 'a?b', 'a\nb', 'a\x1bb']) {
      await expect(writeTags(file, ['kept', bad])).rejects.toThrow(UserError);
    }
    await expect(writeTags(file, ['x'.repeat(2049)])).rejects.toThrow(UserError);
    expect(await readTags(file)).toEqual(['kept']);
  });

  it('returns a foreign tag that a later write refuses', async () => {
    setXattr(file, USER_TAGS, bplist(['a,b']));
    const tags = await readTags(file);
    expect(tags).toEqual(['a,b']);
    await expect(writeTags(file, tags)).rejects.toThrow(UserError);
    await writeTags(file, ['a-b']); // renaming away the bad spelling works
    expect(await readTags(file)).toEqual(['a-b']);
  });

  it('never writes through a symlink, and reads the link, not its target', async () => {
    const link = join(home(), 'link');
    await writeTags(file, ['target']);
    await symlink(file, link);
    await expect(writeTags(link, ['x'])).rejects.toThrow(UserError);
    expect(await readTags(link)).toEqual([]);
    expect(await readTags(file)).toEqual(['target']);
  });

  it('tags a directory', async () => {
    const dir = join(home(), 'dir');
    await mkdir(dir);
    await writeTags(dir, ['a']);
    expect(await readTags(dir)).toEqual(['a']);
  });

  it('probes a volume and cleans up', async () => {
    expect(await supported(file)).toBe(true);
    expect(await supported(home())).toBe(true);
    expect(execFileSync('ls', ['-A', home()]).toString()).not.toContain('probe');
    await expect(supported(join(home(), 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('detects a screen capture from the attribute', async () => {
    expect(isScreenCapture(file)).toBe(false);
    const name = 'com.apple.metadata:kMDItemIsScreenCapture';
    setXattr(file, name, Buffer.from('damaged'));
    expect(isScreenCapture(file)).toBe(false);
    // A binary plist holding `true`: header, object, offset table, trailer.
    const trailer = Buffer.alloc(32);
    trailer.set([1, 1], 6);
    trailer[15] = 1;
    trailer[31] = 9;
    setXattr(file, name, Buffer.concat([Buffer.from('bplist00'), Buffer.from([9, 8]), trailer]));
    expect(isScreenCapture(file)).toBe(true);
    expect(isScreenCapture(join(home(), 'missing'))).toBe(false);
  });
});

const stream = () => `${file}:jevonganize.tags`;

/** Loads a fresh tags.ts that believes it runs on `platform`. */
async function tagsOn(platform: NodeJS.Platform) {
  vi.resetModules();
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  return await import('../src/core/tags.ts');
}

describe('the linux backend, against a fake libc', () => {
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

describe('the win32 backend, with a sibling file standing in for the stream', () => {
  afterEach(() => {
    vi.doUnmock('node:fs/promises');
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

  it('restores mtime after a stream write moved it', async () => {
    const old = new Date('2020-01-02T03:04:05Z');
    await utimes(file, old, old);
    // A stream write moves the file's mtime on Windows. A sibling file would not, so simulate it.
    vi.doMock('node:fs/promises', async (original) => {
      const real = await original<typeof FsPromises>();
      return {
        ...real,
        writeFile: async (...args: Parameters<typeof real.writeFile>) => {
          await real.writeFile(...args);
          await real.utimes(file, new Date(), new Date());
        },
      };
    });
    const tags = await tagsOn('win32');
    await tags.writeTags(file, ['a']);
    expect((await stat(file)).mtime).toEqual(old);
  });
});
