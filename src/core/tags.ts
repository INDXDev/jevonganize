/**
 * The only OS boundary: every read and write of a file's tags. Identical on every OS, and only the
 * backend differs. See docs/tags.md.
 *
 * - macOS keeps a binary plist in an xattr, and may also hold a legacy colour in FinderInfo.
 * - Linux keeps a comma list in an xattr.
 * - Windows keeps a comma list in an NTFS stream.
 *
 * Everything above the backends sees the same thing: a normalized list of tags. The public functions
 * come first; the backends, and the native calls they need, follow.
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
import { normalize, storableTags } from './tag-rules.ts';

/** How one OS stores a file's tags. */
interface Backend {
  read(path: string): Promise<Tag[]>;
  write(path: string, tags: Tag[]): Promise<void>;
}

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

/**
 * True where saving over a file drops its tags with the file id unchanged. `CREATE_ALWAYS`, which is
 * `fopen(path, "w")`, deletes every stream, so only a changed `mtime` tells this from a person.
 */
export const overwriteDropsTags = isWindows;

/** A file's tags: normalized and sorted, and `[]` when untagged. Throws if the file is missing. */
export async function readTags(path: string): Promise<Tag[]> {
  return normalize(await backend.read(path));
}

/**
 * Replaces a file's tags, and `[]` clears them. A set that breaks a rule writes nothing. Does not
 * follow a symlink, and callers merge first: see docs/tags.md.
 */
export async function writeTags(path: string, tags: Tag[]): Promise<void> {
  const storable = storableTags(path, tags);
  if ((await lstat(path)).isSymbolicLink()) throw new UserError(`${path} is a symbolic link`);
  await backend.write(path, storable);
}

/** Whether each volume, by device id, can hold tags. */
const volumeSupport = new Map<number, boolean>();

/** Can this volume store tags? Round-trips a throwaway file once per volume. */
export async function supported(path: string): Promise<boolean> {
  const info = await stat(path);
  const remembered = volumeSupport.get(info.dev);
  if (remembered !== undefined) return remembered;
  const folder = info.isDirectory() ? path : dirname(path);
  const probe = join(folder, `.jevonganize-probe-${randomUUID()}`);
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } catch {
    return false; // says something about this folder, not the volume, so it is not remembered
  }
  const canTag = await roundTripsTag(probe);
  await rm(probe, { force: true });
  volumeSupport.set(info.dev, canTag);
  return canTag;
}

/** True when a tag written to this file reads back. */
async function roundTripsTag(probe: string): Promise<boolean> {
  try {
    await backend.write(probe, ['probe']);
    return (await backend.read(probe))[0] === 'probe';
  } catch {
    return false;
  }
}

/** True when macOS marked this file as a screenshot. Reads the xattr, as Spotlight may lag. */
export function isScreenCapture(path: string): boolean {
  if (!isMac) return false;
  try {
    const raw = readXattr(path, SCREEN_CAPTURE);
    return raw !== null && parseBuffer(raw)[0] === true;
  } catch {
    return false;
  }
}

// --- xattr through libc, the only native surface on macOS and Linux ---------------------------

const XATTR_NOFOLLOW = 1;

/**
 * libc's xattr calls, and the arguments each takes after the value. Linux has `l` variants that do
 * not follow a symlink; macOS instead takes a position and options, where XATTR_NOFOLLOW does it.
 */
const XATTR_API = isMac
  ? {
      library: 'libSystem.dylib',
      get: 'intptr_t getxattr(const char *p, const char *n, _Out_ uint8_t *b, size_t s, uint32_t pos, int opt)',
      set: 'int setxattr(const char *p, const char *n, const uint8_t *b, size_t s, uint32_t pos, int flags)',
      remove: 'int removexattr(const char *p, const char *n, int opt)',
      getArgs: [0, XATTR_NOFOLLOW],
      setArgs: [0, XATTR_NOFOLLOW],
      removeArgs: [XATTR_NOFOLLOW],
      /** ENOATTR, then ENOTSUP: a volume that cannot hold tags has none. */
      noValueErrnos: [93, 45],
    }
  : {
      library: 'libc.so.6',
      get: 'intptr_t lgetxattr(const char *p, const char *n, _Out_ uint8_t *b, size_t s)',
      set: 'int lsetxattr(const char *p, const char *n, const uint8_t *b, size_t s, int flags)',
      remove: 'int lremovexattr(const char *p, const char *n)',
      getArgs: [],
      setArgs: [0],
      removeArgs: [],
      /** ENODATA, then ENOTSUP: a volume that cannot hold tags has none. */
      noValueErrnos: [61, 95],
    };

const libc = isWindows ? null : koffi.load(XATTR_API.library);
const xattrCalls = libc && {
  get: libc.func(XATTR_API.get),
  set: libc.func(XATTR_API.set),
  remove: libc.func(XATTR_API.remove),
};

/** The xattr calls. Only the macOS and Linux backends use them, and only there do they load. */
function xattr() {
  if (!xattrCalls) throw new Error('xattr is not available on this platform');
  return xattrCalls;
}

const lastCallFoundNoValue = () => XATTR_API.noValueErrnos.includes(koffi.errno());

function xattrError(operation: string, path: string): Error {
  const code = getSystemErrorName(-koffi.errno());
  return Object.assign(new Error(`${operation} ${path}: ${code}`), { code });
}

/** An attribute's bytes, or null when the file has none by that name. */
function readXattr(path: string, name: string): Buffer | null {
  const { get } = xattr();
  const size = get(path, name, null, 0, ...XATTR_API.getArgs) as number;
  if (size < 0) {
    if (lastCallFoundNoValue()) return null;
    throw xattrError('getxattr', path);
  }
  const buffer = Buffer.alloc(size);
  const bytesRead = get(path, name, buffer, size, ...XATTR_API.getArgs) as number;
  if (bytesRead < 0) throw xattrError('getxattr', path);
  return buffer;
}

function writeXattr(path: string, name: string, value: Buffer): void {
  const status = xattr().set(path, name, value, value.length, ...XATTR_API.setArgs) as number;
  if (status < 0) throw xattrError('setxattr', path);
}

/** Removes an attribute. One that is already gone is not an error. */
function removeXattr(path: string, name: string): void {
  const failed = (xattr().remove(path, name, ...XATTR_API.removeArgs) as number) < 0;
  if (failed && !lastCallFoundNoValue()) throw xattrError('removexattr', path);
}

// --- macOS ------------------------------------------------------------------------------------

const USER_TAGS = 'com.apple.metadata:_kMDItemUserTags';
const FINDER_INFO = 'com.apple.FinderInfo';
const SCREEN_CAPTURE = 'com.apple.metadata:kMDItemIsScreenCapture';
/** Finder's names for the legacy colours, by number. 0 is no colour. */
const LEGACY_COLOUR_NAMES = ['', 'Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'];
/** Where FinderInfo keeps the legacy colour: bits 1 to 3 of this byte. */
const COLOUR_BYTE = 9;
const COLOUR_BITS = 0x0e;

/** The legacy colour number in a FinderInfo value, 0 for none. */
const legacyColour = (finderInfo: Buffer | null) =>
  ((finderInfo?.[COLOUR_BYTE] ?? 0) & COLOUR_BITS) >> 1;

/** Tag name to colour digit, from the bplist of `USER_TAGS`. */
function parseUserTags(raw: Buffer, path: string): Map<Tag, string> {
  // Garbage throws rather than reading as untagged, so a write cannot overwrite what it can't read.
  const list: unknown = parseBuffer(raw)[0];
  if (!Array.isArray(list)) throw new Error(`${USER_TAGS} on ${path} is not a list`);
  const colourByTag = new Map<Tag, string>();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const [name = '', colour = '0'] = entry.split('\n');
    colourByTag.set(name.normalize('NFC'), colour);
  }
  return colourByTag;
}

/** Tag name to colour digit. Falls back to the legacy FinderInfo colour, as `NSURLTagNamesKey` does. */
function macColourByTag(path: string): Map<Tag, string> {
  const raw = readXattr(path, USER_TAGS);
  if (raw) return parseUserTags(raw, path);
  const colour = legacyColour(readXattr(path, FINDER_INFO));
  if (colour === 0) return new Map();
  return new Map([[LEGACY_COLOUR_NAMES[colour] ?? '', String(colour)]]);
}

/** Takes the legacy colour off a file, and FinderInfo too when nothing else is left in it. */
function clearLegacyColour(path: string): void {
  const info = readXattr(path, FINDER_INFO);
  if (!info || legacyColour(info) === 0) return;
  info[COLOUR_BYTE] = (info[COLOUR_BYTE] ?? 0) & ~COLOUR_BITS;
  const otherInfoLeft = info.some(Boolean);
  if (otherInfoLeft) writeXattr(path, FINDER_INFO, info);
  else removeXattr(path, FINDER_INFO);
}

const macBackend: Backend = {
  read: async (path) => [...macColourByTag(path).keys()],
  write: async (path, tags) => {
    const colourByTag = macColourByTag(path); // keeps colours set in Finder
    const entries = tags.map((tag) => `${tag}\n${colourByTag.get(tag) ?? 0}`);
    if (tags.length) writeXattr(path, USER_TAGS, bplist(entries));
    else removeXattr(path, USER_TAGS);
    clearLegacyColour(path); // a stale colour bit comes back as a tag
  },
};

// --- Linux ------------------------------------------------------------------------------------

const XDG_TAGS = 'user.xdg.tags';

const linuxBackend: Backend = {
  read: async (path) => (readXattr(path, XDG_TAGS)?.toString() ?? '').split(','),
  write: async (path, tags) => {
    if (tags.length) writeXattr(path, XDG_TAGS, Buffer.from(tags.join(',')));
    else removeXattr(path, XDG_TAGS);
  },
};

// --- Windows ----------------------------------------------------------------------------------

/** The NTFS stream that holds a file's tags. */
function tagStreamPath(path: string): string {
  // `C` + `:name` would mean a file on drive C.
  if (!isAbsolute(path)) throw new UserError(`${path} is not an absolute path`);
  return `${path}:jevonganize.tags`;
}

// Windows keeps 100 ns ticks and `fs.utimes` takes milliseconds, so it cannot put a time back.
const kernel32 = isWindows ? koffi.load('kernel32.dll') : null;
const windowsFileApi = kernel32 && {
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
const INVALID_HANDLE = -1;
/** 100 ns ticks from 1601, the Windows epoch, to 1970. */
const UNIX_EPOCH_TICKS = 116_444_736_000_000_000n;

/** A FILETIME: little-endian 100 ns ticks since 1601, from nanoseconds since 1970. */
function fileTime(ns: bigint): Buffer {
  const time = Buffer.alloc(8);
  time.writeBigUInt64LE(ns / 100n + UNIX_EPOCH_TICKS);
  return time;
}

/** Puts a file's times back, tick for tick. Moves `ctime`, as the stream write already did. */
function restoreTimes(path: string, { atimeNs, mtimeNs }: BigIntStats): void {
  if (!windowsFileApi) throw new Error('The Windows file API is not available on this platform');
  const { open, setTimes, close } = windowsFileApi;
  const openArgs = [FILE_WRITE_ATTRIBUTES, SHARE_ALL, null, OPEN_EXISTING, OPEN_LINK_ITSELF, null];
  const handle = open(toNamespacedPath(path), ...openArgs) as number;
  if (handle === INVALID_HANDLE) {
    throw new Error(`Could not open ${path} to restore its modified time`);
  }
  try {
    const keepCreated = null;
    const restored = setTimes(handle, keepCreated, fileTime(atimeNs), fileTime(mtimeNs));
    if (!restored) throw new Error(`Could not restore the modified time of ${path}`);
  } finally {
    close(handle);
  }
}

const windowsBackend: Backend = {
  read: async (path) => {
    const stream = tagStreamPath(path);
    await stat(path); // a missing file must throw, as on POSIX, not read as untagged
    return ((await ifExists(readFile(stream, 'utf8'))) ?? '').split(',');
  },
  write: async (path, tags) => {
    const before = await stat(path, { bigint: true });
    if (tags.length) await writeFile(tagStreamPath(path), tags.join(','));
    else await ifExists(unlink(tagStreamPath(path)));
    // Any stream write moves mtime on Windows, which would make the file look edited.
    restoreTimes(path, before);
  },
};

// --- The backend for this OS ------------------------------------------------------------------

function platformBackend(): Backend {
  const backends: Partial<Record<NodeJS.Platform, Backend>> = {
    darwin: macBackend,
    linux: linuxBackend,
    win32: windowsBackend,
  };
  const found = backends[process.platform];
  if (!found) throw new UserError(`File tags are not supported on ${process.platform}`);
  return found;
}

const backend = platformBackend();
