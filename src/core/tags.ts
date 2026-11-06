/**
 * The only OS boundary: every read and write of a file's tags. Identical on every OS, and only the
 * `backends` table differs. See docs/tags.md.
 *
 * macOS keeps a binary plist in an xattr, and may also hold a legacy colour in FinderInfo. Linux
 * keeps a comma list in an xattr, and Windows a comma list in an NTFS stream. Everything above the
 * backends sees the same thing: a normalized list of tags.
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
const FORBIDDEN = /[\p{Cc},;"\\*?]/u;

/** NFC, trimmed, unique ignoring case with the first spelling kept, sorted by code unit. */
export function normalize(tags: Tag[]): Tag[] {
  const seen = new Map<string, Tag>();
  for (const tag of tags) {
    const clean = tag.normalize('NFC').trim();
    if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()].toSorted();
}

/** Normalizes tags, and throws on the first one the rules forbid. */
export function validTags(tags: Tag[]): Tag[] {
  const clean = normalize(tags);
  const bad = clean.find((tag) => FORBIDDEN.test(tag));
  if (bad !== undefined) {
    throw new UserError(`Tag ${JSON.stringify(bad)} has a character tags cannot contain`);
  }
  return clean;
}

// xattr through libc, the only native surface. macOS adds position and option arguments.
const isMac = process.platform === 'darwin';
const NOFOLLOW = 1; // XATTR_NOFOLLOW. Elsewhere the `l` variants do the same job
const namePrefix = isMac ? '' : 'l';
const getParams = `const char *p, const char *n, _Out_ uint8_t *b, size_t s${isMac ? ', uint32_t pos, int opt' : ''}`;
const setParams = `const char *p, const char *n, const uint8_t *b, size_t s, ${isMac ? 'uint32_t pos, ' : ''}int flags`;
const removeParams = `const char *p, const char *n${isMac ? ', int opt' : ''}`;
const libc =
  process.platform === 'win32' ? null : koffi.load(isMac ? 'libSystem.dylib' : 'libc.so.6');
const xattr = libc && {
  get: libc.func(`intptr_t ${namePrefix}getxattr(${getParams})`),
  set: libc.func(`int ${namePrefix}setxattr(${setParams})`),
  del: libc.func(`int ${namePrefix}removexattr(${removeParams})`),
};
/** ENOATTR or ENODATA, then ENOTSUP: a volume that cannot hold tags has none. */
const NO_VALUE = isMac ? [93, 45] : [61, 95];

function xattrError(operation: string, path: string): Error {
  const code = getSystemErrorName(-koffi.errno());
  return Object.assign(new Error(`${operation} ${path}: ${code}`), { code });
}

function readXattr(path: string, name: string): Buffer | null {
  const tail = isMac ? [0, NOFOLLOW] : [];
  const size = xattr!.get(path, name, null, 0, ...tail) as number;
  if (size < 0) {
    if (NO_VALUE.includes(koffi.errno())) return null;
    throw xattrError('getxattr', path);
  }
  const buffer = Buffer.alloc(size);
  const bytesRead = xattr!.get(path, name, buffer, size, ...tail) as number;
  if (bytesRead < 0) throw xattrError('getxattr', path);
  return buffer;
}

function writeXattr(path: string, name: string, value: Buffer): void {
  const tail = isMac ? [0, NOFOLLOW] : [0];
  const status = xattr!.set(path, name, value, value.length, ...tail) as number;
  if (status < 0) throw xattrError('setxattr', path);
}

function removeXattr(path: string, name: string): void {
  const tail = isMac ? [NOFOLLOW] : [];
  const failed = (xattr!.del(path, name, ...tail) as number) < 0;
  if (failed && !NO_VALUE.includes(koffi.errno())) throw xattrError('removexattr', path);
}

interface Backend {
  read(path: string): Promise<Tag[]>;
  write(path: string, tags: Tag[]): Promise<void>;
}

const USER_TAGS = 'com.apple.metadata:_kMDItemUserTags';
const FINDER_INFO = 'com.apple.FinderInfo';
const SCREEN_CAPTURE = 'com.apple.metadata:kMDItemIsScreenCapture';
const LABELS = ['', 'Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'];
/** Where FinderInfo keeps the legacy colour: bits 1 to 3 of this byte. */
const COLOUR_BYTE = 9;
const COLOUR_BITS = 0x0e;

const finderColour = (info: Buffer | null) => ((info?.[COLOUR_BYTE] ?? 0) & COLOUR_BITS) >> 1;

/** Tag name to colour digit, from the bplist of `USER_TAGS`. */
function parseUserTags(raw: Buffer, path: string): Map<Tag, string> {
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

/** Tag name to colour digit. Falls back to the legacy FinderInfo colour, as `NSURLTagNamesKey` does. */
function macEntries(path: string): Map<Tag, string> {
  const raw = readXattr(path, USER_TAGS);
  if (raw) return parseUserTags(raw, path);
  const colour = finderColour(readXattr(path, FINDER_INFO));
  return new Map(colour ? [[LABELS[colour] ?? '', String(colour)]] : []);
}

/** Takes the legacy colour off a file, and FinderInfo too when nothing else is left in it. */
function clearFinderColour(path: string): void {
  const info = readXattr(path, FINDER_INFO);
  if (!info || finderColour(info) === 0) return;
  info[COLOUR_BYTE] = (info[COLOUR_BYTE] ?? 0) & ~COLOUR_BITS;
  if (info.some(Boolean)) writeXattr(path, FINDER_INFO, info);
  else removeXattr(path, FINDER_INFO);
}

const darwin: Backend = {
  read: async (path) => [...macEntries(path).keys()],
  write: async (path, tags) => {
    const old = macEntries(path); // keeps colours set in Finder
    const entries = tags.map((tag) => `${tag}\n${old.get(tag) ?? 0}`);
    if (tags.length) writeXattr(path, USER_TAGS, bplist(entries));
    else removeXattr(path, USER_TAGS);
    clearFinderColour(path); // a stale colour bit comes back as a tag
  },
};

const XDG_TAGS = 'user.xdg.tags';
const linux: Backend = {
  read: async (path) => (readXattr(path, XDG_TAGS)?.toString() ?? '').split(','),
  write: async (path, tags) =>
    tags.length
      ? writeXattr(path, XDG_TAGS, Buffer.from(tags.join(',')))
      : removeXattr(path, XDG_TAGS),
};

function tagStream(path: string): string {
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
    const name = tagStream(path);
    await stat(path); // a missing file must throw, as on POSIX, not read as untagged
    return ((await ifExists(readFile(name, 'utf8'))) ?? '').split(',');
  },
  write: async (path, tags) => {
    const before = await stat(path, { bigint: true });
    if (tags.length) await writeFile(tagStream(path), tags.join(','));
    else await ifExists(unlink(tagStream(path)));
    // Any stream write moves mtime on Windows, which would make the file look edited.
    restoreTimes(path, before);
  },
};

/**
 * True where saving over a file drops its tags with the file id unchanged. `CREATE_ALWAYS`, which is
 * `fopen(path, "w")`, deletes every stream, so only a changed `mtime` tells this from a person.
 */
export const overwriteDropsTags = process.platform === 'win32';

function platformBackend(): Backend {
  const backends: Partial<Record<NodeJS.Platform, Backend>> = { darwin, linux, win32 };
  const found = backends[process.platform];
  if (!found) throw new UserError(`File tags are not supported on ${process.platform}`);
  return found;
}

const backend = platformBackend();

/** A file's tags: normalized and sorted, and `[]` when untagged. Throws if the file is missing. */
export async function readTags(path: string): Promise<Tag[]> {
  return normalize(await backend.read(path));
}

/**
 * Replaces a file's tags, and `[]` clears them. A set that breaks a rule writes nothing. Does not
 * follow a symlink, and callers merge first: see docs/tags.md.
 */
export async function writeTags(path: string, tags: Tag[]): Promise<void> {
  const clean = validTags(tags);
  if (Buffer.byteLength(clean.join(',')) > MAX_BYTES) {
    throw new UserError(`The tags for ${path} are over ${MAX_BYTES} bytes`);
  }
  if ((await lstat(path)).isSymbolicLink()) throw new UserError(`${path} is a symbolic link`);
  await backend.write(path, clean);
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

const volumeSupport = new Map<number, boolean>();

/** Can this volume store tags? Round-trips a throwaway file once per volume. */
export async function supported(path: string): Promise<boolean> {
  const info = await stat(path);
  const known = volumeSupport.get(info.dev);
  if (known !== undefined) return known;
  const folder = info.isDirectory() ? path : dirname(path);
  const probe = join(folder, `.jevonganize-probe-${randomUUID()}`);
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } catch {
    return false; // says something about this folder, not the volume, so it is not remembered
  }
  const works = await roundTripsTag(probe);
  await rm(probe, { force: true });
  volumeSupport.set(info.dev, works);
  return works;
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
