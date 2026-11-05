# OS-native file tags for Jevonganize

Research date: 2026-11-06. Test machine: macOS 14.8.9 (Darwin 23.6), Node 24.22.1, Electron 45.2.3.

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| **[E]** | Verified by experiment on this Mac, on scratch files only |
| **[D]** | Primary documentation or upstream source code |
| **[3P]** | Third-party writing (blogs, forums); treat as likely, not certain |
| **[U]** | Unverified: stated as an expectation, not a finding |

Linux and Windows behaviour is **not** experimentally verified. No Windows machine was available, and the Docker daemon was not running and was not started. Section 9 lists every gap.

## 1. Recommendation

**One interface, one store per OS, no per-file-type branching.**

```ts
readTags(path: string): Promise<string[]>                // normalised, sorted; [] when untagged
writeTags(path: string, tags: string[]): Promise<void>   // replaces the whole set; [] clears it
supported(path: string): Promise<boolean>                // can tags be stored on this volume?
```

Same functions, same tag strings and same validation on every OS. The only per-OS code is this backend table:

| OS | Store | Encoding | Visible in the native file manager? |
|---|---|---|---|
| macOS | xattr `com.apple.metadata:_kMDItemUserTags` | Binary plist array of `name\ncolour` | **Yes**: Finder tags, Spotlight |
| Linux | xattr `user.xdg.tags` | UTF-8, comma-joined | **KDE yes** (Dolphin/Baloo), **GNOME no** |
| Windows | NTFS stream `:jevonganize.tags` | UTF-8, comma-joined | **No**: invisible in Explorer |

**Libraries:** `koffi` (xattr through libc), `bplist-parser` + `bplist-creator` (macOS only), Node built-ins for everything else, including Windows streams and file watching. See section 6.

**The owner must accept one thing.** "Visible in Finder/Explorer/file managers" can be met on macOS and KDE only. On Windows, no uniform store is visible in Explorer. On GNOME, nothing is. Section 5 explains why the Windows trade-off still favours a single ADS store.

### Where identical behaviour is truly impossible

| # | Difference | Consequence | Mitigation |
|---|---|---|---|
| 1 | Native visibility | Explorer and Nautilus show nothing | Show tags in the app; say so in the docs |
| 2 | **Tag write changes mtime on Windows only** | "Any stream write updates the file times" [D]; macOS leaves mtime alone [E], Linux should too [U]. Backup and sync tools may re-process the file | Optionally restore mtime with `fs.utimes` after writing (ctime still moves) |
| 3 | Finder colours exist on macOS only | Not part of the tag string | Preserve existing colours on write; do not model them (tested [E]) |
| 4 | Foreign tags that break the rules | Finder allows `a,b`; `writeTags` rejects it, and Linux cannot store a comma at all | UI must let the user rename such a tag |
| 5 | Same volume type, different `supported()` | exFAT is `true` on macOS through `._` sidecars [E], `false` on Linux [D] and Windows [U] | Report the boolean; nothing else |
| 6 | Copy survival differs | See sections 3.6, 4 and 5 | Document it; the app's own copies must carry tags |
| 7 | **Tags do not cross OSes** | Three separate stores. A file moved from Mac to Linux loses its tags in practice | Out of scope; a dual-write would add code and a sync problem |
| 8 | OS search | Spotlight and Baloo index these tags; Windows Search will not see an ADS | Search through the app's cache |

### Design rules that follow

- **The cache key is `mtimeNs + ctimeNs + size`, never mtime alone.** On macOS an xattr write changes ctime but not mtime [E].
- **Tags die with atomic saves.** Any editor that saves by write-temp-then-rename drops them on macOS [E] (`sed -i` lost tags too). A database cache that notices tags vanished can warn, but must not silently restore them, or the database stops being a mere cache.
- **The app's own copy must re-apply tags.** Node `fs.copyFile` and `fs.cp` lose them [E]. After any copy: `writeTags(dst, await readTags(src))`.
- **Do not use chokidar or @parcel/watcher for tag changes.** Both ignore changes that leave mtime alone on macOS [E]. Use built-in `fs.watch` (section 8).
- **Run scans in a worker, not the Electron main thread.** koffi calls here are synchronous; koffi loads in a `worker_thread` [E].

## 2. Interface code

This file ran on Node 24 directly (type stripping, no build step). On macOS it passed against APFS, HFS+, exFAT, FAT32 and a read-only APFS image [E]: round-trip including CJK and emoji-ZWJ tags, readback through `NSURLTagNamesKey`, colour preservation, legacy colour handling, rejection of bad tags, `ENOENT` on a missing file, and directories.

**The `linux` and `win32` backends below have never been executed.** Treat them as a specification until run on those systems.

```ts
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getSystemErrorName } from 'node:util';
import koffi from 'koffi';
import { parseBuffer } from 'bplist-parser';
import bplist from 'bplist-creator';

export const MAX_BYTES = 2048; // shortcut: fits one ext4 block with room to spare; raise only with evidence
const FORBIDDEN = /[\p{Cc},;"\\*?]/u; // ',' = Linux separator, ';' = Explorer separator, rest = query syntax

/** NFC, trimmed, case-insensitive unique (first spelling wins), sorted. */
export function normalize(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags) {
    const s = t.normalize('NFC').trim();
    if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  }
  return [...seen.values()].sort();
}

// --- xattr via libc: the only platform-specific native surface (macOS adds position/options args) ---
const mac = process.platform === 'darwin';
const libc = process.platform === 'win32' ? null : koffi.load(mac ? 'libSystem.dylib' : 'libc.so.6');
const x = libc && {
  get: libc.func(`intptr_t getxattr(const char *p, const char *n, _Out_ uint8_t *b, size_t s${mac ? ', uint32_t pos, int opt' : ''})`),
  set: libc.func(`int setxattr(const char *p, const char *n, const uint8_t *b, size_t s, ${mac ? 'uint32_t pos, ' : ''}int flags)`),
  del: libc.func(`int removexattr(const char *p, const char *n${mac ? ', int opt' : ''})`),
};
const NOATTR = mac ? 93 : 61; // ENOATTR / ENODATA
const fail = (op: string, p: string) => {
  const code = getSystemErrorName(-koffi.errno());
  return Object.assign(new Error(`${op} ${p}: ${code}`), { code });
};
function xget(p: string, n: string): Buffer | null {
  const tail = mac ? [0, 0] : [];
  const size = x!.get(p, n, null, 0, ...tail);
  if (size < 0) { if (koffi.errno() === NOATTR) return null; throw fail('getxattr', p); }
  const b = Buffer.alloc(size);
  if (x!.get(p, n, b, size, ...tail) < 0) throw fail('getxattr', p);
  return b;
}
function xset(p: string, n: string, v: Buffer) {
  if (x!.set(p, n, v, v.length, ...(mac ? [0, 0] : [0])) < 0) throw fail('setxattr', p);
}
function xdel(p: string, n: string) {
  if (x!.del(p, n, ...(mac ? [0] : [])) < 0 && koffi.errno() !== NOATTR) throw fail('removexattr', p);
}

// --- backends: the only thing that differs per OS ---
type Backend = { read(p: string): Promise<string[]>; write(p: string, tags: string[]): Promise<void> };

const USER_TAGS = 'com.apple.metadata:_kMDItemUserTags';
const FINDER_INFO = 'com.apple.FinderInfo';
const LABELS = ['', 'Gray', 'Green', 'Purple', 'Blue', 'Yellow', 'Red', 'Orange'];
/** name -> colour digit. Falls back to the legacy FinderInfo colour, as NSURLTagNamesKey does. */
function macEntries(p: string): Map<string, string> {
  const raw = xget(p, USER_TAGS);
  if (raw) return new Map((parseBuffer(raw)[0] as string[]).map((e) => {
    const [name, colour = '0'] = e.split('\n');
    return [name.normalize('NFC'), colour];
  }));
  const c = ((xget(p, FINDER_INFO)?.[9] ?? 0) >> 1) & 7;
  return new Map(c ? [[LABELS[c], String(c)]] : []);
}
const darwin: Backend = {
  read: async (p) => [...macEntries(p).keys()],
  write: async (p, tags) => {
    const old = macEntries(p); // keep colours set in Finder
    if (tags.length) xset(p, USER_TAGS, bplist(tags.map((t) => `${t}\n${old.get(t) ?? 0}`)));
    else xdel(p, USER_TAGS);
    const fi = xget(p, FINDER_INFO); // a stale colour bit would resurrect as a tag: verified by experiment
    if (fi && fi[9] & 0x0e) {
      fi[9] &= ~0x0e;
      if (fi.some(Boolean)) xset(p, FINDER_INFO, fi); else xdel(p, FINDER_INFO);
    }
  },
};
const XDG = 'user.xdg.tags';
const linux: Backend = {
  read: async (p) => (xget(p, XDG)?.toString() ?? '').split(','),
  write: async (p, tags) => (tags.length ? xset(p, XDG, Buffer.from(tags.join(','))) : xdel(p, XDG)),
};
const STREAM = ':jevonganize.tags';
const win32: Backend = {
  read: async (p) => {
    await stat(p); // a missing file must throw, as on POSIX, not read as untagged
    return readFile(p + STREAM, 'utf8').catch((e) => { if (e.code === 'ENOENT') return ''; throw e; }).then((s) => s.split(','));
  },
  write: async (p, tags) => {
    if (tags.length) await writeFile(p + STREAM, tags.join(','));
    else await unlink(p + STREAM).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  },
};
const backend = ({ darwin, linux, win32 } as Record<string, Backend>)[process.platform];

// --- the whole public interface ---
export const readTags = async (path: string) => normalize(await backend.read(path));

export async function writeTags(path: string, tags: string[]) {
  const t = normalize(tags);
  const bad = t.find((s) => FORBIDDEN.test(s));
  if (bad !== undefined) throw new RangeError(`forbidden character in tag: ${JSON.stringify(bad)}`);
  if (Buffer.byteLength(t.join(',')) > MAX_BYTES) throw new RangeError('tag set too large');
  await backend.write(path, t);
}

const volumes = new Map<number, boolean>();
/** Can tags be stored next to this path? Round-trips a throwaway file once per volume. */
export async function supported(path: string): Promise<boolean> {
  const st = await stat(path);
  const { dev } = st;
  if (!volumes.has(dev)) {
    const probe = join(st.isDirectory() ? path : dirname(path), `.jevonganize-probe-${process.pid}`);
    let ok = false;
    try {
      await writeFile(probe, '');
      await backend.write(probe, ['probe']);
      ok = (await backend.read(probe))[0] === 'probe';
    } catch { /* unsupported or read-only */ }
    await unlink(probe).catch(() => {});
    volumes.set(dev, ok);
  }
  return volumes.get(dev)!;
}
```

## 3. macOS

### 3.1 Format

The xattr `com.apple.metadata:_kMDItemUserTags` holds a binary plist array of strings, each `name\n<colour>` [3P][E]. Details from a raw dump of what the system writes [E]:

- ASCII names are stored as ASCII; **non-ASCII names as UTF-16BE**. Any writer must handle both; `bplist-creator` does (its output read back correctly through `NSURL`).
- `NSURLTagNamesKey` wrote `\n0` for every tag, even `Red`.
- On read, `NSURL` accepts entries with no `\n` suffix, and accepts an XML plist in the xattr. Write binary regardless.
- Clearing through `NSURL` leaves a 42-byte empty plist, not a missing attribute. A reader must handle `[]`. Finder reportedly deletes the attribute [3P]; our backend deletes it too.
- A tag containing `\n` is silently truncated at the newline (`new\nline` read back as `new`). Hence the validation.

### 3.2 Colour numbers

From `NSWorkspace.fileLabels` [E]; matches Eclectic Light [3P].

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| None | Gray | Green | Purple | Blue | Yellow | Red | Orange |

### 3.3 `com.apple.FinderInfo` and when to sync it

The colour lives in **byte 9**, bits 1-3, as `label << 1`, so red (6) is `0x0C` [E].

| Action | Result [E] |
|---|---|
| Set `NSURLLabelNumberKey` | Writes FinderInfo only, no tag xattr; `NSURLTagNamesKey` still reports `Red` |
| Set tags through `NSURL` | Writes no FinderInfo on macOS 14 (older reports say Finder writes a null one [3P]) |
| Set tags through `NSURL` on a file with a legacy colour | Removes the colour, and deletes FinderInfo once it is all zeros |
| Direct xattr write on a file with a legacy colour | Tag xattr wins on read, but the colour bit stays |
| Then delete the tag xattr | **The old colour reappears as a tag** |
| Direct xattr write of `Red\n6` | `NSURLLabelNumberKey` stays 0 (it reads FinderInfo only) |

**Rule:** FinderInfo never needs setting. It needs *clearing* whenever the app writes tags, or removed tags can come back. Legacy colours remain reachable today through `NSURLLabelNumberKey`, and AppleScript reportedly uses the same store [3P], so handle them. Preserve the other FinderInfo bytes. `tags.ts` does all this in five lines.

### 3.4 Do direct xattr writes get picked up?

| Consumer | Picked up? |
|---|---|
| `NSURLTagNamesKey` (documented read-write since 10.9 [D]) | **Yes**, immediately [E] |
| `mdls` | **Yes** [E] |
| Spotlight / `mdfind kMDItemUserTags` | **Yes**: searchable 1.6 s after the write; removal also seen within 5 s [E] |
| Finder window | **Not visually checked**. It is expected, as the values above are the same store; open a tagged test file once to confirm |

The Spotlight test used a scratch APFS volume with `mdutil -i on`. `/tmp` is not indexed, and a freshly mounted image starts with indexing disabled.

### 3.5 Fast query, limits, tooling

**Query:** `mdfind -0 -onlyin <root> 'kMDItemUserTags == "*"'` lists tagged files. Tested behaviour [E]:

- `==` is **case-sensitive**: `"mixed case"` found 0, `"mixed case"c` found 1.
- `year/*` wildcards, `/`, `:` and CJK all match.
- A colour held only in FinderInfo does **not** match. It appears as `kMDItemFSLabel` instead.
- The query took about 0.1 s here, but this machine had no tagged files outside the test, so **that says nothing about scale**.

Spotlight skips excluded folders, `.noindex`, much of `~/Library` [3P], and unindexed volumes, so it cannot be the source of truth. **Skip it in v1.** A plain walk with `readTags` is uniform across OSes and took about 0.3 s per 10,000 files (section 6). Add `mdfind` later only if a real library proves too slow.

**Size limits:**

| Limit | Value |
|---|---|
| Attribute name | 127 bytes; 128 gives `ENAMETOOLONG` [E], matching `XATTR_MAXNAMELEN` [D] |
| Value, APFS | 128 MiB accepted, the largest size tried [E] |
| Value, HFS+/exFAT/FAT32 | 1 MiB accepted; 64 MiB failed only because the test image was 64 MB [E] |
| Tag length | No documented limit found. A 300-character tag and a 2,000-tag set (26.9 KB) round-tripped through `NSURL` [E]. Finder's UI limit is untested |

The `tag` CLI (jdberry/tag, 1.6k stars, last push 2024-07) adds, removes, sets and lists tags; `--find` uses the Spotlight database [3P]. It is useful for manual checks, but it is not a dependency: requiring a Homebrew install is unnecessary. `NSURLTagNamesKey` is the official API, but it needs Objective-C or Swift. The direct xattr route is equivalent as far as tested, and avoids shipping a native helper.

### 3.6 What survives [E unless marked]

| Kept | Lost |
|---|---|
| `cp`, `cp -p`, `cp -c` (clone), `ditto` | `cp -X`, `ditto --norsrc` |
| `mv` on the same volume, and APFS to HFS+ | `cat a > b` |
| Copy to exFAT and back to APFS | **Node `fs.copyFile`, `fs.cp`**, even with `COPYFILE_FICLONE` |
| `rsync -aE` (Apple rsync 2.6.9) | `rsync -a` (no `-E`) |
| `tar` (bsdtar, macOS to macOS) | `zip` + `unzip` |
| `ditto -c -k` then `ditto -x -k` (the mechanism behind Finder Compress [U]) | `ditto` zip opened with CLI `unzip` (left in `__MACOSX/`) |
| In-place append (`>>`) | **`git clone`, `git checkout` rewrites** |
| | **Rename-over save, `sed -i`** |

| Not tested | Reported |
|---|---|
| iCloud Drive | Kept, including on evicted files [3P] |
| Dropbox | Officially listed as synced, including to Linux and Windows under its own names [D] |
| Google Drive | Lost, per one forum report [3P] |
| NFS and some network systems | "Not always preserved" [3P] |

**Non-APFS volumes [E]:** HFS+ stores tags natively. exFAT and FAT32 work through a 4 KB AppleDouble `._name` sidecar, and the tag reads back normally. Those sidecars show up on Windows and Linux, and copying only the main file there loses the tags. The probe in `supported()` left no residue on exFAT or FAT32.

## 4. Linux

**Correction to the brief:** `user.xdg.tags` is **not** in freedesktop's CommonExtendedAttributes page. An archived copy (December 2024, last edited May 2021) proposes `user.xdg.comment`, `user.xdg.origin.*`, `user.xdg.language` and others, but no tags. The live page returned 403 to automated fetching. It is a **KDE de facto convention**, not a specification.

| Topic | Finding |
|---|---|
| Format | `tags.join(',')` on write, `split(',', SkipEmptyParts)` on read, no escaping, in KFileMetaData `usermetadata.cpp` [D]. A comma inside a tag cannot be represented |
| Rating | `user.baloo.rating`, an integer; 0-10 half-stars [3P] |
| Baloo's role | The xattr is the store; Baloo is only the search index [3P]. Same architecture as this project |
| Dolphin | Reads the xattrs; `/` nests tags under `tags:/` (`Parent/Child`), with open bugs on deep nesting [3P] |
| GNOME Nautilus | **No user tags.** Native tagging was shelved in 2017; only a "star" feature and read-only media metadata exist [3P] |
| Tracker / localsearch | `nao:hasTag` lives in its database, not in xattrs; called neglected [3P]. No evidence that it reads `user.xdg.tags` |
| Rules | User xattrs apply to regular files and directories only; sticky directories restrict access [D] |
| Tools | `setfattr -n user.xdg.tags -v 'a,b' f`; `getfattr -n user.xdg.tags f`. From the `attr` package, often not preinstalled, so do not depend on them at runtime |

| Filesystem | User xattrs | Size limit |
|---|---|---|
| ext4 | Yes | All names and values together fit one block, usually 4 KB [D]; up to 64 KB with `ea_inode` [3P] |
| btrfs | Yes | Name + value + overhead up to nodesize, 16 KB by default [D] |
| XFS | Yes | VFS limit: 64 KB value, 255-byte name [D] |
| tmpfs | Linux 6.6+ only, limited [3P]; earlier kernels no | Limited by tmpfs accounting |
| NFS | Only NFSv4.2 with client and server support (RFC 8276) [3P] | Server-dependent |
| vfat, exFAT | **No**: no xattr code in `fs/fat/inode.c`, `fs/exfat/super.c` or `fs/exfat/file.c` [D]; the VFS returns `EOPNOTSUPP` [D] | n/a |

`MAX_BYTES = 2048` keeps every tag set inside the tightest common limit, ext4's single block, while leaving room for other attributes. It applies on all OSes so the behaviour stays identical. A 1 KB-block ext4 could still fail, and the error surfaces to the caller.

**Node access:** Node has no xattr API, so Linux uses the same koffi code as macOS, with two fewer arguments per call. `libc.so.6` assumes glibc, so musl needs a different library name [U].

## 5. Windows

**There is no universal file tag.** `System.Keywords`, shown as "Tags", is a property that exists only where a handler supports the file type.

### 5.1 `System.Keywords`

- Multi-value string, `PKEY_Keywords`, FMTID `F29F85E0-4FF9-1068-AB91-08002B27B3D9`, PID 5 [D]. That matches `PIDSI_KEYWORDS` (0x05) in the OLE SummaryInformation set [D].
- Explorer reads and writes it through a **per-extension property handler** [D], and the value lives **inside the file**.

| Format | Tags in Explorer? | Stored in |
|---|---|---|
| JPEG, TIFF | **Yes** | XMP `dc:subject`, IPTC keywords, EXIF `0x4747` (18247) and `XPKeywords` `0x9C9E` (40094), plus `MicrosoftPhoto:LastKeyword*`; schemas are merged on read [D] |
| .doc, .ppt (OLE compound) | **Yes** [D] | `\005SummaryInformation` stream inside the compound file, property 5 [D] |
| .docx, .xlsx, .pptx | Yes [U] | `docProps/core.xml`, `cp:keywords`, a delimited string [3P quoting the OPC schema] |
| MP3, WMA, WMV | Listed as handled [D]; the Tags field specifically is not confirmed | Format-specific |
| **PDF** | **No** by default; third-party handler needed [Microsoft Q&A, 3P] | n/a |
| **PNG** | **Unclear**: PNG editing may depend on the Windows 11 build (reported from 25987), and tags reportedly disappear on transfer [3P] | n/a |
| **.txt, most others** | **No** | Plain text has no metadata slot, so no handler can store one inside the file |

Explorer edits properties only in the Properties dialog [D]. Keywords can be entered as one semicolon-delimited string [D], which is why `;` is forbidden in tags.

### 5.2 Alternate Data Streams

- **Visibility:** none in Explorer. `dir /r`, `Get-Item -Stream *` and tools like NirSoft AlternateStreamView show them [3P][D].
- **From Node:** no native code. "Under NTFS, if the filename contains a colon, Node.js will open a file system stream" [D]. Use absolute paths: a one-letter relative name can be misread as a drive [D].
- **From PowerShell:** `Get-Content`, `Set-Content`, `Remove-Item` and others take `-Stream` [D]. Not needed by the app; useful for debugging.
- **Times:** streams have no file times of their own, and "the file times for a file are updated when any stream in a file is updated" [D].
- **Copy:** survives NTFS to NTFS [3P]; lost on FAT/exFAT, where Explorer warns first [3P]. Lost by email, upload and zip [Raymond Chen]. Explorer may not copy streams on folders [3P].
- **Save:** `ReplaceFile` keeps named streams not already in the replacement [D]. That helps only apps that use it. Others behave like macOS rename-saves [U].
- **Filesystems:** NTFS and ReFS support named streams [D]. FAT/exFAT do not.
- **Sync:** Dropbox's list covers only its own named streams, so `:jevonganize.tags` is probably not synced [D, inferred]. No source found for OneDrive.

### 5.3 Things to avoid

- **Legacy `\005SummaryInformation` as an ADS.** Windows 2000/XP used it for formats with no internal slot. **Vista dropped it** because "alternate data streams were found to be too fragile" [Raymond Chen]; such streams still exist on old files and show in scanners [3P]. Explorer no longer uses it, so writing one gains nothing.
- **NTFS extended attributes (`$EA`).** They exist [D] but neither Explorer nor Node exposes them.

**Note the warning in that history:** Microsoft rejected this exact design for being easy to lose. Our data has the same fragility and the UI should not hide it.

### 5.4 File Metadata (Dijji/FileMeta)

A property handler that stores properties in an NTFS stream, making them visible and searchable through Explorer for chosen extensions [3P]. It needs a machine-wide COM install and per-extension setup, and cannot extend some built-in handlers [3P]. The last release was v1.6 in January 2020, the last push July 2021 [D]. It proves that **a custom handler can surface an ADS in Explorer**, but it is not a dependency to adopt.

### 5.5 Single ADS versus System.Keywords split

| | **A: ADS for every file (recommended)** | B: Keywords where a handler exists, else ADS |
|---|---|---|
| **Explorer visibility** | **None, for any file** | JPEG/TIFF/Office yes; PDF, .txt, most others no |
| Identical semantics | Yes | **No**: outcome depends on file type and installed handlers |
| Coverage | Every file on NTFS/ReFS | Same, in two stores |
| Modifies file content | **No** | **Yes**: changes hashes and can invalidate signatures [U] |
| Survives email, zip, cloud | **No** | Keywords files yes; the rest no |
| Windows Search | No | Keywords files yes |
| Code | About 10 lines, Node built-ins | COM from Node, or a PowerShell host, plus migration between stores and per-format rules |
| Speed | File read | COM or process spawn per file [U] |
| Tag fidelity | Exact | Handler-dependent: merged schemas, `;` splitting |

No compile-free write path to `System.Keywords` was confirmed. `Shell.Application` is commonly used for reading only, and writing needs `IPropertyStore`, reached through `Add-Type` C#, koffi COM vtables, or exiftool for images. None was tested.

**Choose A.** It is the only option that meets "simple and same interface". What it costs, plainly: **a Windows user opening Explorer sees no tags at all, on any file, and Windows Search cannot find them.** Option B would show tags on photos and Office files, but only there, at the price of rewriting user files and of two stores.

**If Windows visibility later becomes essential:** add a signed COM property handler that reads the same stream, as File Metadata does. The store and interface stay unchanged, so that decision can wait.

## 6. Libraries

Selection rule from the owner: modern, trending and widely adopted in popular Node/TypeScript repos; avoid obscure or abandoned packages. Data collected 2026-11-05/06. "Repo hits" is GitHub code search for the name in `package.json`, a rough count.

### xattr

| Option | Age | Releases | Latest | npm/month | Repo hits | Prebuilt | Verdict |
|---|---|---|---|---|---|---|---|
| **`koffi` 3.3.7** | 4.7 y | 290 | **2026-11-05** | **16.9 M** | **~3,976**, incl. Electron apps | **Yes**, 20 platform packages | **Pick** |
| `ffi-rs` 1.3.7 | 3.2 y | not checked | 2026-08 | 1.2 M | not checked | Yes | Viable, smaller |
| `@napi-rs/xattr` 1.0.3 | 3.0 y | 4 | 2025-09-15 | 26 k | ~6 | Yes; no Windows | Simplest API, but obscure |
| `fs-xattr` 0.4.0 | 12.8 y | 23 | **2021-05-11** | 740 k | ~193 | **No** | Abandoned |
| `xattr`, `node-xattr`, `fs-extended-attributes` | old | | 2012-2022 | | | | Abandoned |
| Spawn `/usr/bin/xattr` | | | | | | n/a | **About 67 s per 10,000 files**; `getfattr` often absent |
| Node 24 built-in | | | | | | | **Does not exist** |

Why koffi: it is the only candidate that is modern, active and widely used. It costs about 25 lines of FFI declarations, tested above. Those lines are the price of avoiding an obscure package: mistakes in raw FFI can crash rather than throw, and it has a single maintainer. If the owner prefers the shortest possible code over adoption, `@napi-rs/xattr` removes those lines; only `xget`, `xset` and `xdel` change.

**`fs-xattr` note:** it did fail to install here, but the cause was this machine's broken pyenv shim. With `PYTHON=/usr/bin/python3` it compiled and loaded under Node 24 and Electron 45 [E]. It stays rejected because it needs a compiler at every install and has had no release since May 2021 (the 2022 date on npm is a metadata change).

Benchmark, 10,000 files, half tagged, two rounds, warm cache, APFS [E]. Spawn is extrapolated from 200 files:

| Method | Time |
|---|---|
| `stat` only | 30-37 ms |
| koffi sync | 262-314 ms |
| koffi async (batches of 64) | 192-288 ms |
| `@napi-rs/xattr` sync / async | 294-301 / 166-188 ms |
| `fs-xattr` sync | 368-390 ms |
| `@napi-rs/xattr` read + plist parse | 441-655 ms |
| Spawning `xattr` | ~66,700 ms |

Bindings are effectively equal; the choice does not affect speed. `tags.ts` makes two `getxattr` calls per tagged file and that exact version was not benchmarked. Cold-cache and network volumes were not measured.

**Electron:** all three bindings loaded and read a tag inside Electron 45.2.3 (Node 24.22.2) under `ELECTRON_RUN_AS_NODE` [E]. Not tested: a real main or utility process, a renderer, or a packaged `asar` build. Native binaries generally need `asarUnpack`. Keep this code out of the renderer.

**Installs:** npm 11.19 here blocked koffi's install script pending approval, and koffi worked anyway because the binary comes from a platform package [E]. `@parcel/watcher` installed the same way.

### Plist

| Option | Age | Latest | npm/month | Repo hits | Binary? | Verdict |
|---|---|---|---|---|---|---|
| **`bplist-parser` 0.5.0** | 14 y, modernised | **2026-09-05** (ESM + CJS, Node >= 20.19) | **124.8 M** | ~721: expo, appium, cordova-ios, PostHog | Read | **Pick**, zero deps |
| **`bplist-creator` 0.3.0** | 13 y, modernised | **2026-09-05** | **67.6 M** | ~280: expo, appium | Write | **Pick**, one dep (`stream-buffers`) |
| `plist` 5.0.0 | | 2026-05 | 101 M | | **XML only** | Cannot read Finder's data |
| `@expo/plist` | | 2026-11 | 69.6 M | | XML [U] | Same limitation |
| `simple-plist` 1.3.1 | | 2022 | 58 M | | Both, pinned to old versions | Stale |
| `@plist/*` | 2022 | 2024-01 | 19-76 k | | Yes | Cleanest design, little use, stale |
| `bplist-universal` | 2023 | 2026-10 | 2.7 k | | Yes | Obscure |
| Hand-written writer | | | | | | Rejected: UTF-16 and offset tables are needless code to own |

Both picks are macOS-only at runtime and could be lazy-loaded. Not worth it; 200 KB in total.

### Watching

**Built-in `fs.watch`; no library.** See section 8. chokidar 6 (850 M/month) and `@parcel/watcher` (172 M/month) are the modern defaults, and either is fine for *content* changes, but both miss what this app needs.

## 7. Portable tag encoding

**On disk a tag is one flat string.** `/` and `:` are conventions that only the app interprets, so `year/2024` stays a valid plain tag everywhere.

| Rule | Value | Why |
|---|---|---|
| Hierarchy | `/` (`year/2024`) | Dolphin nests on it [3P]; plain text in Finder |
| Key/value | First `:` (`fiscal-year:FY2025`) | Works everywhere tested; see warning |
| Forbidden | Control characters, `,` `;` `"` `\` `*` `?` | `,` Linux separator; `;` Explorer separator; control including `\n`: macOS format; the rest: `mdfind` query syntax |
| Normalisation | NFC + trim, on read and write | `NSURL` stores NFC and NFD as different tags [E] |
| Case | Preserved; unique case-insensitively, first spelling wins | `NSURL` kept `Upper` and `upper` as two tags, and Spotlight `==` is case-sensitive [E] |
| Order | Sorted by code unit | Tags are a set; order has no meaning |
| Size | 2,048 UTF-8 bytes per file | ext4 |

`/` and `:` passed every macOS layer tested: `NSURL`, `mdls`, `mdfind` exact and wildcard [E].

**Warning on `:`** Eclectic Light says colons in tags have caused problems in some macOS versions [3P]. The owner's `fiscal-year:FY2025` worked on macOS 14, but it has not been checked in Finder's UI (typing it, or the tag sidebar) or on other macOS versions. If it fails, `/` can express the same thing as `fiscal-year/FY2025`, with no change to storage.

Emoji survive: `\p{Cc}` is used rather than `\p{C}`, because the broader class would reject the zero-width joiner in sequences like 👩‍💻 [E].

## 8. Detecting external changes

| | macOS | Linux | Windows |
|---|---|---|---|
| mtime on tag write | **Unchanged** [E] | Unchanged [U] | **Changes** [D] |
| ctime on tag write | **Changes** [E] | Changes [U] | ChangeTime expected to change [U]; libuv maps it to `ctime` [D] |
| Parent directory times | Unchanged [E] | [U] | [U] |
| Size | Unchanged [E] | [U] | Main-stream size unchanged [U] |
| Event source | FSEvents, with `ItemXattrMod` [D] | inotify `IN_ATTRIB` covers `setxattr` [D] | `ReadDirectoryChangesW`; last-write notification, stream not identified [D][3P] |

ctime also changes on `chmod` and hard-linking [E], so a change means "re-read", not "tags changed". That is harmless.

**What each watcher does on macOS [E]** (settled files, repeated writes, content change as control):

| Watcher | xattr set | Second set | xattr remove | Content change |
|---|---|---|---|---|
| **`fs.watch(dir, {recursive:true})`** | **Yes** | **Yes** | **Yes** | Yes |
| `fs.watch(dir)` / `fs.watch(file)` | Yes | Yes | Yes | Yes |
| chokidar 6 | **No** | **No** | **No** | Yes |
| `@parcel/watcher` 2.6 | First only, as `create` | **No** | **No** | Yes |

The cause is in their source. chokidar compares `size`, `mtimeMs` and inode; parcel sees `ItemXattrMod` but ignores events with an unchanged mtime [D]. Note that `fs.watch` reports xattr changes on macOS as `rename`, so treat every event type alike.

**Recommended design:**

1. `fs.watch(root, { recursive: true })`; recursive has covered Linux since Node 19.1 [D].
2. For each event: `stat` the path, compare `mtimeNs:ctimeNs:size` with the cache, and re-read tags on a difference.
3. Run the same comparison as a full walk at startup and periodically. It catches anything missed. About 3 µs per file for `stat` here, so it is cheap.

The walk is required, not optional. inotify misses remote changes and needs a watch per directory under `max_user_watches` [D]. `ReadDirectoryChangesW` can overflow and drop events [D]. `fs.watch` is unreliable on network filesystems [D]. libuv registers `IN_ATTRIB` and the Windows last-write filter [D], so events are expected there, but this is untested.

Your own writes also trigger events. Update the cache key after each `writeTags`, or the app re-reads its own change (harmless, but wasteful).

## 9. What was not verified

| Gap | Risk | How to close |
|---|---|---|
| **Windows backend never run** | Medium: `unlink` on a stream, directory streams, `stat` of `ctime`, the `supported()` probe on FAT | Run `tags.ts` tests on Windows 11, NTFS and exFAT |
| **Linux backend never run** | Low to medium: same koffi code path as macOS, different signatures | Run the tests in a Linux VM or CI, on ext4, tmpfs and vfat |
| **Finder window not visually checked** | Low: colour display and colon in the UI | Tag a test file with `tags.ts` and open it in Finder |
| iCloud, Dropbox, OneDrive, Google Drive | Medium: third-party or absent evidence | Test with disposable accounts |
| Electron real process and packaged build | Medium: `asar` unpacking | Spike with the chosen wrapper |
| PNG/OOXML/audio `System.Keywords` on current Windows 11 | Low: affects only option B | Check on a real build |
| Spotlight at scale; cold-cache and network timing | Low: `mdfind` not used in v1 | Benchmark on a real library |
| Other macOS versions (only 14.8.9 tested) | Low to medium: the format is undocumented by Apple | Include macOS 15+ in CI |

`_kMDItemUserTags` is a private on-disk format, only `NSURLTagNamesKey` is documented API. It has been stable for years and third parties, including Dropbox, depend on it, but Apple makes no promise. The tests above are worth keeping as a regression check.

## Sources

**Apple**
- `tagNamesKey`: https://developer.apple.com/documentation/foundation/urlresourcekey/tagnameskey
- `kFSEventStreamEventFlagItemXattrMod`: https://developer.apple.com/documentation/coreservices/kfseventstreameventflagitemxattrmod
- macOS SDK headers `sys/xattr.h`, `sys/errno.h` (local)

**macOS, third party**
- Eclectic Light, Solving Finder tag problems: https://eclecticlight.co/2024/12/24/solving-finder-tag-problems/
- Eclectic Light, Finder tags xattr: https://eclecticlight.co/2017/12/27/xattr-com-apple-metadata_kmditemusertags-finder-tags/
- Eclectic Light, FinderInfo: https://eclecticlight.co/2017/12/19/xattr-com-apple-finderinfo-information-for-the-finder/
- `tag` CLI: https://github.com/jdberry/tag

**Linux and freedesktop**
- CommonExtendedAttributes (archived): https://web.archive.org/web/2024/https://www.freedesktop.org/wiki/CommonExtendedAttributes/
- KFileMetaData source: https://raw.githubusercontent.com/KDE/kfilemetadata/master/src/usermetadata.cpp
- `xattr(7)`: https://man7.org/linux/man-pages/man7/xattr.7.html
- `inotify(7)`: https://man7.org/linux/man-pages/man7/inotify.7.html
- Kernel sources: https://github.com/torvalds/linux/tree/master/fs (`xattr.c`, `fat/inode.c`, `exfat/`)
- Baloo tagging: https://vhanda.in/blog/2014/07/tagging-your-files
- Dolphin xattr behaviour: https://mail.kde.org/pipermail/kfm-devel/2021-March/038135.html
- Preserving xattrs (`user.baloo.rating`): https://dekonvoluted.github.io/user%20guides/2014/12/15/preserving-extended-attributes-while-copying-files.html
- Dolphin nested tags: https://bugs.kde.org/show_bug.cgi?id=334615 , https://bugs.kde.org/show_bug.cgi?id=434374 , https://discuss.kde.org/t/nested-tags-in-dolphin/40450
- GNOME: https://discourse.gnome.org/t/file-tagging-in-nautilus/11374 , https://discourse.gnome.org/t/support-file-extended-attributes-and-access-control-lists/14923 , https://www.omgubuntu.co.uk/2017/07/nautilus-may-add-favorite-files-instead-of-tags
- Tracker tags: https://gitlab.gnome.org/GNOME/tracker-miners/-/issues/182 , https://discourse.gnome.org/t/tagging-doesnt-seem-to-work-in-tracker3-what-am-i-doing-wrong/6863
- tmpfs xattrs: https://www.phoronix.com/news/Linux-6.6-Tmpfs
- NFS xattrs: https://lore.kernel.org/linux-nfs/20200623223904.31643-1-fllinden@amazon.com/
- ext4 `ea_inode`: https://lore.kernel.org/all/YMojdN145g9JqAC8@mit.edu/

**Microsoft**
- `System.Keywords`: https://learn.microsoft.com/en-us/windows/win32/properties/props-system-keywords
- Keywords photo metadata policy: https://learn.microsoft.com/en-us/windows/win32/wic/-wic-photoprop-system-keywords
- Property system overview: https://learn.microsoft.com/en-us/windows/win32/properties/property-system-overview
- Property lists: https://learn.microsoft.com/en-us/windows/win32/properties/building-property-handlers-property-lists
- `PIDSI_KEYWORDS`: https://msdn.microsoft.com/en-us/openspecs/windows_protocols/MS-OLEPS/b6182507-5cdf-4403-83a0-b94f7095e90b
- File streams: https://learn.microsoft.com/en-us/windows/win32/fileio/file-streams
- Naming files: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
- `ReplaceFile`: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilea
- `ReadDirectoryChangesW`: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw
- ReFS features: https://learn.microsoft.com/en-us/windows-server/storage/refs/refs-overview
- Raymond Chen on Summary information in streams: https://devblogs.microsoft.com/oldnewthing/20120501-00/?p=7733
- Tags not available for PDF (Q&A): https://learn.microsoft.com/en-us/answers/a/6000237
- Alternate data streams in NTFS: https://learn.microsoft.com/en-nz/archive/blogs/askcore/alternate-data-streams-in-ntfs
- `Get-Content -Stream`: https://learn.microsoft.com/en-us/previous-versions/powershell/module/microsoft.powershell.management/get-content?view=powershell-7

**Windows, third party**
- File Metadata: https://github.com/Dijji/FileMeta , https://github.com/Dijji/FileMeta/wiki/FAQ , https://github.com/Dijji/FileMeta/releases/tag/v1.6
- PDF handler status: https://www.voidtools.com/forum/viewtopic.php?p=55354
- PNG tags: https://www.elevenforum.com/t/tags-keywords-wont-stick-to-pngs.26671/ , https://www.elevenforum.com/t/add-change-and-remove-file-property-details-in-windows-11.17866/latest
- ADS copy behaviour: https://www.winhelponline.com/blog/copy-this-file-without-properties-prompt/ , https://learn.microsoft.com/en-ca/answers/questions/179716/explorer-does-not-copy-alternative-data-streams-fo
- ADS and `ReadDirectoryChangesW`: https://community.osr.com/t/question-about-ntfs-alternate-data-streams/19958
- AlternateStreamView: https://www.nirsoft.net/utils/alternate_data_streams.html
- OOXML core properties: https://python-docx-oss.readthedocs.io/en/latest/dev/analysis/features/coreprops.html

**Sync services**
- Dropbox extended attributes: https://help.dropbox.com/sync/extended-attributes
- Google Drive report: https://forum.c-command.com/t/google-docs-instead-of-dropbox-still-not-recommended/10985

**Node and libraries**
- Node `fs` docs: https://nodejs.org/api/fs.html (source: https://github.com/nodejs/node/blob/v24.x/doc/api/fs.md)
- libuv: https://github.com/libuv/libuv/tree/v1.x/src
- koffi: https://github.com/Koromix/koffi
- `@napi-rs/xattr`: https://github.com/Brooooooklyn/xattr
- `fs-xattr`: https://github.com/LinusU/fs-xattr
- bplist: https://github.com/joeferner/node-bplist-parser , https://github.com/joeferner/node-bplist-creator
- plist.js: https://github.com/TooTallNate/plist.js
- `@parcel/watcher`: https://github.com/parcel-bundler/watcher
- chokidar: https://github.com/paulmillr/chokidar
- npm download API: https://api.npmjs.org/downloads/point/last-month/koffi
