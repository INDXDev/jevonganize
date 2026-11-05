/**
 * The only OS boundary: every read and write of a file's tags. Identical on every OS, and only the
 * `backends` table differs. See docs/tags.md.
 *
 * CI runs each backend on its own OS, against the real store: test/tags.test.ts reads the attribute
 * or stream back. That covers Windows Server NTFS and the runners' Linux volume, and no file manager.
 */
import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, toNamespacedPath } from 'node:path';
import { getSystemErrorName } from 'node:util';
import bplist from 'bplist-creator';
import { parseBuffer } from 'bplist-parser';
import koffi from 'koffi';
import type { Tag } from '../types.ts';
import { ifExists, UserError } from './config.ts';

// shortcut: fits one ext4 block with room to spare, raise it only with evidence from real sets.
const MAX_BYTES = 2048;
/** `,` is the Linux separator, `;` Explorer's, a newline breaks macOS, the rest is query syntax. */
export const FORBIDDEN = /[\p{Cc},;"\\*?]/u;

/** NFC, trimmed, unique ignoring case with the first spelling kept, sorted by code unit. */
export function normalize(tags: Tag[]): Tag[] {
  const seen = new Map<string, Tag>();
  for (const tag of tags) {
    const clean = tag.normalize('NFC').trim();
    if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()].toSorted();
}

// xattr through libc, the only native surface. macOS adds position and option arguments.
const mac = process.platform === 'darwin';
const NOFOLLOW = 1; // XATTR_NOFOLLOW. Elsewhere the `l` variants do the same job
const prefix = mac ? '' : 'l';
const libc =
  process.platform === 'win32' ? null : koffi.load(mac ? 'libSystem.dylib' : 'libc.so.6');
const xattr = libc && {
  get: libc.func(
    `intptr_t ${prefix}getxattr(const char *p, const char *n, _Out_ uint8_t *b, size_t s${mac ? ', uint32_t pos, int opt' : ''})`,
  ),
  set: libc.func(
    `int ${prefix}setxattr(const char *p, const char *n, const uint8_t *b, size_t s, ${mac ? 'uint32_t pos, ' : ''}int flags)`,
  ),
  del: libc.func(`int ${prefix}removexattr(const char *p, const char *n${mac ? ', int opt' : ''})`),
};
/** ENOATTR or ENODATA, then ENOTSUP: a volume that cannot hold tags has none. */
const NO_VALUE = mac ? [93, 45] : [61, 95];

function failure(operation: string, path: string): Error {
  const code = getSystemErrorName(-koffi.errno());
  return Object.assign(new Error(`${operation} ${path}: ${code}`), { code });
}

function xget(path: string, name: string): Buffer | null {
  const tail = mac ? [0, NOFOLLOW] : [];
  const size = xattr!.get(path, name, null, 0, ...tail) as number;
  if (size < 0) {
    if (NO_VALUE.includes(koffi.errno())) return null;
    throw failure('getxattr', path);
  }
  const buffer = Buffer.alloc(size);
  if ((xattr!.get(path, name, buffer, size, ...tail) as number) < 0) {
    throw failure('getxattr', path);
  }
  return buffer;
}

function xset(path: string, name: string, value: Buffer): void {
  const tail = mac ? [0, NOFOLLOW] : [0];
  if ((xattr!.set(path, name, value, value.length, ...tail) as number) < 0) {
    throw failure('setxattr', path);
  }
}

function xdel(path: string, name: string): void {
  const failed = (xattr!.del(path, name, ...(mac ? [NOFOLLOW] : [])) as number) < 0;
  if (failed && !NO_VALUE.includes(koffi.errno())) throw failure('removexattr', path);
}

interface Backend {
  read(path: string): Promise<Tag[]>;
  write(path: string, tags: Tag[]): Promise<void>;
}

const USER_TAGS = 'com.apple.metadata:_kMDItemUserTags';
const FINDER_INFO = 'com.apple.FinderInfo';
const SCREEN_CAPTURE = 'com.apple.metadata:kMDItemIsScreenCapture';
const LABELS = ['', 'Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'];

/** Tag name to colour digit. Falls back to the legacy FinderInfo colour, as `NSURLTagNamesKey` does. */
function macEntries(path: string): Map<Tag, string> {
  const raw = xget(path, USER_TAGS);
  if (raw) {
    // Garbage throws rather than reading as untagged, so a write cannot overwrite what it can't read.
    const list: unknown = parseBuffer(raw)[0];
    if (!Array.isArray(list)) throw new Error(`${USER_TAGS} on ${path} is not a list`);
    const entries = list.filter((entry) => typeof entry === 'string');
    return new Map(
      entries.map((entry) => {
        const [name = '', colour = '0'] = entry.split('\n');
        return [name.normalize('NFC'), colour];
      }),
    );
  }
  const colour = ((xget(path, FINDER_INFO)?.[9] ?? 0) >> 1) & 7;
  return new Map(colour ? [[LABELS[colour] ?? '', String(colour)]] : []);
}

const darwin: Backend = {
  read: async (path) => [...macEntries(path).keys()],
  write: async (path, tags) => {
    const old = macEntries(path); // keeps colours set in Finder
    if (tags.length) {
      xset(path, USER_TAGS, bplist(tags.map((tag) => `${tag}\n${old.get(tag) ?? 0}`)));
    } else xdel(path, USER_TAGS);
    const info = xget(path, FINDER_INFO); // a stale colour bit comes back as a tag
    if (info && (info[9] ?? 0) & 0x0e) {
      info[9] = (info[9] ?? 0) & ~0x0e;
      if (info.some(Boolean)) xset(path, FINDER_INFO, info);
      else xdel(path, FINDER_INFO);
    }
  },
};

const XDG_TAGS = 'user.xdg.tags';
const linux: Backend = {
  read: async (path) => (xget(path, XDG_TAGS)?.toString() ?? '').split(','),
  write: async (path, tags) =>
    tags.length ? xset(path, XDG_TAGS, Buffer.from(tags.join(','))) : xdel(path, XDG_TAGS),
};

function stream(path: string): string {
  // `C` + `:name` would mean a file on drive C.
  if (!isAbsolute(path)) throw new UserError(`${path} is not an absolute path`);
  return `${path}:jevonganize.tags`;
}

// Windows keeps 100 ns ticks and `fs.utimes` takes milliseconds, so it cannot put a time back.
const kernel32 = process.platform === 'win32' ? koffi.load('kernel32.dll') : null;
const fileApi = kernel32 && {
  open: kernel32.func(
    'intptr_t __stdcall CreateFileW(const char16_t *p, uint32_t access, uint32_t share, void *sa, uint32_t mode, uint32_t flags, void *tpl)',
  ),
  setTimes: kernel32.func(
    'int __stdcall SetFileTime(intptr_t h, const uint8_t *created, const uint8_t *accessed, const uint8_t *written)',
  ),
  close: kernel32.func('int __stdcall CloseHandle(intptr_t h)'),
};
const FILE_WRITE_ATTRIBUTES = 0x100;
const SHARE_ALL = 7;
const OPEN_EXISTING = 3;
const OPEN_LINK_ITSELF = 0x0220_0000; // FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS
const UNIX_EPOCH_TICKS = 116_444_736_000_000_000n;

function fileTime(ns: bigint): Buffer {
  const time = Buffer.alloc(8);
  time.writeBigUInt64LE(ns / 100n + UNIX_EPOCH_TICKS);
  return time;
}

/** Puts a file's times back, tick for tick. Moves `ctime`, as the stream write already did. */
function restoreTimes(path: string, { atimeNs, mtimeNs }: BigIntStats): void {
  const { open, setTimes, close } = fileApi!;
  const flags = [FILE_WRITE_ATTRIBUTES, SHARE_ALL, null, OPEN_EXISTING, OPEN_LINK_ITSELF, null];
  const handle = open(toNamespacedPath(path), ...flags) as number;
  if (handle === -1) throw new Error(`Could not open ${path} to restore its modified time`);
  try {
    if (!setTimes(handle, null, fileTime(atimeNs), fileTime(mtimeNs))) {
      throw new Error(`Could not restore the modified time of ${path}`);
    }
  } finally {
    close(handle);
  }
}

const win32: Backend = {
  read: async (path) => {
    const name = stream(path);
    await stat(path); // a missing file must throw, as on POSIX, not read as untagged
    return ((await ifExists(readFile(name, 'utf8'))) ?? '').split(',');
  },
  write: async (path, tags) => {
    const before = await stat(path, { bigint: true });
    if (tags.length) await writeFile(stream(path), tags.join(','));
    else await ifExists(unlink(stream(path)));
    // Any stream write moves mtime on Windows, which would make the file look edited.
    restoreTimes(path, before);
  },
};

/**
 * True where saving over a file drops its tags with the file id unchanged. `CREATE_ALWAYS`, which is
 * `fopen(path, "w")`, deletes every stream, so only a changed `mtime` tells this from a person.
 */
export const overwriteDropsTags = process.platform === 'win32';

const backends: Partial<Record<NodeJS.Platform, Backend>> = { darwin, linux, win32 };
const backend = backends[process.platform];
if (!backend) throw new UserError(`File tags are not supported on ${process.platform}`);

/** A file's tags: normalized and sorted, and `[]` when untagged. Throws if the file is missing. */
export async function readTags(path: string): Promise<Tag[]> {
  return normalize(await backend!.read(path));
}

/**
 * Replaces a file's tags, and `[]` clears them. A set that breaks a rule writes nothing. Does not
 * follow a symlink, and callers merge first: see docs/tags.md.
 */
export async function writeTags(path: string, tags: Tag[]): Promise<void> {
  const clean = normalize(tags);
  const bad = clean.find((tag) => FORBIDDEN.test(tag));
  if (bad !== undefined) {
    throw new UserError(`Tag ${JSON.stringify(bad)} has a character tags cannot contain`);
  }
  if (Buffer.byteLength(clean.join(',')) > MAX_BYTES) {
    throw new UserError(`The tags for ${path} are over ${MAX_BYTES} bytes`);
  }
  if ((await lstat(path)).isSymbolicLink()) throw new UserError(`${path} is a symbolic link`);
  await backend!.write(path, clean);
}

const volumes = new Map<number, boolean>();

/** Can this volume store tags? Round-trips a throwaway file once per volume. */
export async function supported(path: string): Promise<boolean> {
  const info = await stat(path);
  const known = volumes.get(info.dev);
  if (known !== undefined) return known;
  const probe = join(
    info.isDirectory() ? path : dirname(path),
    `.jevonganize-probe-${randomUUID()}`,
  );
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } catch {
    return false; // says something about this folder, not the volume, so it is not remembered
  }
  let works = false;
  try {
    await backend!.write(probe, ['probe']);
    works = (await backend!.read(probe))[0] === 'probe';
  } catch {
    // no support
  }
  await rm(probe, { force: true });
  volumes.set(info.dev, works);
  return works;
}

/** True when macOS marked this file as a screenshot. Reads the xattr, as Spotlight may lag. */
export function isScreenCapture(path: string): boolean {
  if (!mac) return false;
  try {
    const raw = xget(path, SCREEN_CAPTURE);
    return raw !== null && parseBuffer(raw)[0] === true;
  } catch {
    return false;
  }
}
