# Jevonganize research: extraction, storage, similarity, taxonomy

As of 2026-11-06. Node 24.22.1, macOS 14 on an Apple M1.

**Selection rule (owner decision):** prefer the most modern options that are trending and widely used in popular Node/TypeScript open-source repos, adopted aggressively. A modern, widely used library beats an older one, but obscure or abandoned ones are out. Code stays simple and concise, and the standard library beats a dependency when it does the job. `node:sqlite` is accepted as the default.

**Evidence labels:** *Spike* means I ran it here. *Docs* means read from a primary source. *Judgement* means my own design call, not a sourced fact. Downloads are npm last-week figures, which include CI and transitive installs, so read them as scale rather than user counts.

## 0. Decisions at a glance

| Need | Pick | First published | Last release | Versions | Downloads/wk | Licence |
|---|---|---|---|---|---|---|
| Binary type sniffing | `file-type` 22.3.0 | 2014-04 | 2026-10 | 174 | 79.9M | MIT |
| Extension to MIME (text formats) | `mime` 4.1.2 | 2011-01 | 2026-10 | 59 | 212.0M | MIT |
| Text vs binary | `isbinaryfile` 6.0.0 | 2012-10 | 2025-12 | 41 | 27.0M | MIT |
| Charset detection | `chardet` 2.2.0, decode with built-in `TextDecoder` | 2013-04 | 2026-06 | 30 | 86.3M | MIT |
| PDF text, metadata, render | `unpdf` 2.1.0 (bundles Mozilla pdf.js) | 2023-08 | 2026-10 | 53 | 10.8M | MIT |
| PDF canvas | `@napi-rs/canvas` 1.1.0 | 2021-03 | 2026-10 | 125 | 50.2M | MIT |
| DOCX XLSX PPTX ODF RTF EPUB HTML | `officeparser` 8.5.0, exact pin | 2019-04 | 2026-10 | 80 | 1.45M | MIT |
| Images, thumbnails, SVG | `sharp` 0.35.5 | 2013-08 | 2026-09 | 194 | 158.5M | Apache-2.0 |
| HEIC fallback | `heic-decode` 2.1.0 | 2020-01 | 2025-07 | 8 | 3.74M | ISC (libheif-js is LGPL-3.0) |
| EXIF, XMP, IPTC | `exifreader` 4.54.0 | 2016-12 | 2026-11 | 148 | 0.43M | MPL-2.0 |
| Audio and video tags | `music-metadata` 12.3.4 | 2016-11 | 2026-11 | 326 | 2.47M | MIT |
| Email .eml | `postal-mime` 4.2.0 | 2021-01 | 2026-10 | 73 | 18.4M | MIT-0 |
| Email .msg | `@kenjiuno/msgreader` 1.29.0 | 2019-01 | 2026-10 | 102 | 1.54M | Apache-2.0 |
| Zip listing | `@zip.js/zip.js` 2.24.0 | 2021-01 | 2026-10 | 380 | 8.56M | BSD-3-Clause |
| SQLite | `node:sqlite` (Node >=24.22.1) | built in | | | | |
| File watching | `@parcel/watcher` 2.6.0 | 2018-12 | 2026-07 | 40 | 57.9M | MIT |
| Virtual scrolling | `@tanstack/virtual-core` 3.19.11 (`@tanstack/react-virtual` 3.14.26 if React) | 2022-06 | 2026-11 | 144 | 47.9M | MIT |
| Hashing | `node:crypto` sha256 | built in | | | | |

The whole set installs to **197 MB on darwin-arm64, 58 packages** (spike, clean install, smoke-tested together). `officeparser` and what it forces in (`tesseract.js-core` 43 MB, a pinned `pdfjs-dist` 34 MB) account for over half of that.

**Picks to watch:**
- `officeparser`: the only maintained, widely used library for this format range, but it has the smallest adoption of the core picks and a heavy dependency tree.
- `exifreader`: lowest downloads of the set. The popular choice `exifr` (2.84M/wk) has had no release since 2021-08, so it counts as abandoned.
- `node:sqlite`: release candidate, not yet stable (B.1).

**Watch item, Xberg (`@xberg-io/xberg` 1.3.10, formerly Kreuzberg):** one Rust call handled DOCX, PDF, XLSX, EML, EPUB in 1–14 ms in spike, against roughly 15–155 ms for `officeparser` on the same small files, and its docs claim 107 formats including `.msg` and legacy `.doc`. It could replace `officeparser`, `postal-mime` and `msgreader`. It is out for now under the rule: about 14k downloads/wk, first published 2026-06, and 169 MB native. Bundled OCR also returned garbage on a screenshot. Reconsider if adoption grows.

**Install scripts:** npm's `install-scripts ls` flags three packages. `@parcel/watcher` shows an implied `node-gyp rebuild` only because it ships `binding.gyp`; nothing compiled here, and it loads with `--ignore-scripts` (spike). `exifreader` has a config-only build step and `tesseract.js` a funding postinstall. So no toolchain is required on these platforms, but users may see the warning.

## A. Extraction

### A.1 PDF

| Option | Age, scale | Text | Render | Metadata | Verdict |
|---|---|---|---|---|---|
| `unpdf` + `@napi-rs/canvas` | 2023, 10.8M/wk (engine: pdf.js) | yes | yes | Info + XMP | **Pick** |
| `pdf-parse` 2.4.5 | 2018, 12.5M/wk | yes | yes | yes | Similar wrapper, but last release 2025-10 and 21 MB. No gain over `unpdf` |
| `pdfjs-dist` direct | 2014, 54M/wk | yes | yes | yes | Fallback. Same engine, about 30 more lines of glue |
| `mupdf` WASM | 2023, 1.04M/wk | yes | yes | yes | Rejected: AGPL-3.0 |
| `@llamaindex/liteparse` | 2026, 0.29M/wk, 34 MB | yes | yes | | Rejected: office formats need LibreOffice |

**Recommendation: `unpdf`.** It is the modern, typed, concise API over Mozilla's engine, and the most recently maintained wrapper. Spike on a Quartz-generated PDF with Japanese text: `extractText`, `getMeta` (with `parseDates`) and `renderPageAsImage` all worked; render took 0.6–1.2 s cold and 150–230 ms warm at 1024 px wide.

Caveats from the [unpdf README](https://github.com/unjs/unpdf): set `maxImageSize`, check `numPages` first, and add timeouts, because parsing runs on the event loop.

**Trap (spike):** running `officeparser` on a PDF in the same process as `unpdf` fails with `API version "6.2.108" does not match Worker version "6.4.299"`. Isolated, it works. Never route PDFs to `officeparser`.

### A.2 Office, documents, mail, archives

| Format | Route | Spike result |
|---|---|---|
| DOCX, XLSX, PPTX, ODT, RTF, EPUB, HTML | `officeparser.parseOffice` then `ast.to('text')`, `ast.metadata` | All passed on tiny fixtures. Author, title, created came from core.xml with no extra code (RTF and macOS-generated files have little metadata) |
| ODS, ODP | same | Listed in [README](https://github.com/harshankur/officeParser), not run |
| CSV, TSV, Markdown, code, plain text | Read head bytes, decode, truncate. No library | CSV needs no parser for classification |
| .eml | `postal-mime` `PostalMime.parse` | Passed, including RFC 2047 Japanese subject. Zero deps, more downloads than `mailparser` (8.06M/wk, 8 deps) |
| .msg | `@kenjiuno/msgreader` | **Not run:** no fixture available |
| Zip | `@zip.js/zip.js` `ZipReader` over `fs.openAsBlob` | Passed. Listed a 600 MB zip in 6 ms at 63 MB RSS, reading only the directory. Promise API, 3 lines. `fflate` (149.8M/wk) needs the whole file in memory |
| Legacy .doc .xls .ppt | Optional LibreOffice (A.6), otherwise metadata only | `word-extractor` (1.44M/wk) has had no release since 2021 |

**Recommendation: `officeparser` for everything office-shaped, with `.pdf` excluded.** One call replaces about six libraries and hand-written core.xml parsing.

Alternatives considered:

| Library | Age, scale | Why not |
|---|---|---|
| `mammoth` 1.13.0 | 2013, 15.3M/wk | Widely used, but DOCX only and gives no metadata. Same text in spike, so it adds a dependency and code for nothing here. First swap if DOCX quality disappoints |
| `xlsx` (SheetJS) 0.18.5 on npm | 2013, 15.7M/wk | npm copy frozen since 2022-03 with unfixed CVE-2023-30533 and CVE-2024-22363; fixes ship only as a CDN tarball, per [secondary source](https://www.issoh.co.jp/tech/details/19141/) |
| `exceljs` 4.4.0 | 2014, 26.8M/wk | No release since 2023-10, so treat as abandoned. Best large-file path tested, see below |
| Xberg (ex-Kreuzberg) | 2026, 14k/wk | Works well but obscure today. See watch item in section 0 |

**Large spreadsheet limit (spike, 100k rows, 1.6 MB xlsx):** `officeparser` took 3.4–4.1 s and about 600 MB RSS. `exceljs` streaming read the first 200 rows in about 310 ms at about 157 MB. Cap XLSX input by file size and fall back to metadata only. `exceljs` streaming is the only tested escape hatch, but it is stale, so avoid it unless large sheets turn out to matter.

`officeparser` costs to accept:
- `engines` is `>=24.22.1 <25 || >=26.12.1`, so it warns on older Node 24 and all of Node 25.
- `tesseract.js` is a hard dependency even with OCR off.
- Pin it exactly and test upgrades.

### A.3 Images

- **Thumbnails and resizing: `sharp`.** JPEG to 256 px took 40–70 ms; a 2880x1800 PNG to 1024 px WebP took 0.7–1.6 s; SVG rendered correctly (spike). The [install docs](https://sharp.pixelplumbing.com/install/) list prebuilds for macOS, Linux (glibc and musl) and Windows.
- **HEIC is not in the sharp prebuilds.** Spike: `sharp('x.heic')` throws. The docs list AVIF but not HEIC. Chain: on macOS use `sips`, otherwise `heic-decode` into `sharp` raw input. Spike: `heic-decode` took 1–1.6 s and added about 83 MB RSS on a 5 MP image measured alone, so run one at a time. Its `libheif-js` dependency is LGPL-3.0, so check this before bundling in the native wrapper.
- **Metadata: `exifreader`.** Reads Exif, IPTC, XMP, ICC on JPEG, TIFF, PNG, HEIC, AVIF, WebP ([README](https://github.com/mattiasw/ExifReader)). HEIC and PNG passed in spike. Pass a Buffer, never an untrusted string, because strings are treated as paths or URLs.
- **RAW: optional.** `exifreader` does not claim RAW support and `sharp` cannot decode it. Use `exiftool-vendored` 39.1.0 (2016, 0.20M/wk, active) as an optional accelerator with `extractPreview`. Its [install notes](https://raw.githubusercontent.com/photostructure/exiftool-vendored.js/main/docs/INSTALLATION.md) say minimal Linux needs Perl, so it cannot be required. On macOS, `sips` and `qlmanage` cover many RAW files (not tested).
- **SVG:** `sharp` for pixels; also feed the XML as text, since `<title>` and text nodes are often the best signal.

### A.4 Audio and video

- **`music-metadata`** covers tags, duration and codec, including MP4 and M4A containers (M4A, WAV, AIFF passed in spike; video files were not tested). No ffprobe needed for the basics.
- **`mediabunny` 1.65.2** (2025, 6.8M/wk, MPL-2.0) is the trending TypeScript option, but it does not replace `music-metadata`: it failed on AIFF, and on one audio-only MP4 it gave 0.51 s where `music-metadata` gave 0.60 s (true length not checked). `music-metadata` is itself current (2026-11). Revisit `mediabunny` if video dimensions or codecs become necessary.
- **Keyframes: use `ffmpeg` only if found on PATH.** Do not depend on `ffmpeg-static` (GPL-3.0-or-later package, 3.71M/wk): its [README](https://github.com/eugeneware/ffmpeg-static) says it fetches third-party builds, it adds tens of MB per platform, and it brings licence work to the native wrapper. Without ffmpeg, use `qlmanage -t` on macOS, otherwise classify from filename and metadata.

### A.5 Sniffing, text, screenshots

**Order:** `file-type` on bytes, then `isbinaryfile`, then `mime` by extension.
- `file-type` returned nothing for SVG, HTML, EML and CSV in spike, so the extension step is required.
- `.msg`, `.doc` and `.xls` share one OLE container, so expect to need the extension there too.
- **Trap (spike):** `mime` says `a.ts` is `video/mp2t`, and returns null for `.tsx` and `Dockerfile`. Run `isbinaryfile` first and treat anything non-binary as `text/*`.

**Charsets:** `chardet` detected Shift_JIS correctly. `new TextDecoder(name)` decoded it and accepted all 11 common encodings tried, so `iconv-lite` is unnecessary.

**Screenshots: first match wins.**

| # | Signal | Evidence |
|---|---|---|
| 1 | xattr `com.apple.metadata:kMDItemIsScreenCapture` (also `kMDItemScreenCaptureType`: display, selection) | Spike: present right after `screencapture`, before Spotlight indexed the file, so `mdls` returned null while the xattr was there. **Read the xattr, not mdls** |
| 2 | Filename regex, localised: `Screenshot`, `Screen Shot`, `スクリーンショット`, `Bildschirmfoto`, `Capture d'écran`, `Captura de pantalla` | Judgement. Only the Japanese macOS form was seen here |
| 3 | PNG with no camera Make/Model, and dimensions matching common display sizes | Judgement. Weak signal, so mark it as a hint for the model and do not tag from it alone |

On the spike PNG, EXIF held only pixel size and an ICC profile, with no `UserComment`, so do not rely on embedded metadata.

### A.6 Universal fallbacks (all optional)

| Tool | Gives | Note |
|---|---|---|
| `qlmanage -t -s 512` | Thumbnail for almost anything Quick Look handles, on macOS | Spike: DOCX worked |
| `sips` | HEIC and more to JPEG, on macOS | Spike: worked |
| `textutil -convert txt` | Text from Apple-supported docs, on macOS | Used to create fixtures; not tested on legacy .doc |
| `soffice --headless --convert-to pdf` | Any office format into the PDF route, all OSes | Not tested. Only route for legacy .doc .xls .ppt off macOS |

No widely adopted npm-only universal extractor exists. Use these as the last pipeline stage.

### A.7 Pipeline design

Ordered extractors per MIME glob, merged into one `FileState`. Later extractors only fill what is still empty, so a fallback naturally runs when an earlier stage produced nothing.

```ts
type FileState = {
  text: string;                     // capped by budget
  images: { data: Buffer; mime: string; source: string }[];
  metadata: Record<string, unknown>; // author, title, created, exif..., normalised keys
  warnings: string[];
};

const pipeline = [
  { match: 'application/pdf',  use: ['pdf', 'pdfRender'] },   // pdfRender runs only if text is thin
  { match: 'image/heic',       use: ['heic', 'exif'] },
  { match: 'image/*',          use: ['image', 'exif', 'screenshot'] },
  { match: 'audio/*',          use: ['media'] },
  { match: 'video/*',          use: ['media', 'ffmpegFrames', 'quicklook'] },
  { match: 'message/rfc822',   use: ['eml'] },
  { match: 'application/vnd.ms-outlook', use: ['msg'] },
  { match: 'application/zip',  use: ['zipList'] },
  { match: 'application/vnd.openxmlformats-*', use: ['office', 'quicklook'] },
  { match: 'application/vnd.oasis.*',          use: ['office', 'quicklook'] },
  { match: 'text/*',           use: ['text'] },
  { match: '*',                use: ['quicklook', 'libreoffice'] },
];
```

Run extraction in a `worker_threads` worker and call `worker.terminate()` on timeout. A sync parser cannot be aborted any other way, and a crash then cannot take the server down.

**Default budgets (judgement, tune with real cost data):**

| Cap | Default | Why |
|---|---|---|
| Text to model | 8,000 chars, head-weighted (6,000 start + 2,000 end) | Type and topic show up early; signatures and totals at the end |
| PDF pages read | 10 | |
| Render pages when thin | Up to 3, only if under 200 chars per page | Scanned PDFs need vision; text PDFs do not |
| Images per file | 2 | |
| Image long edge | 768 px, 1024 px for scans | Claude costs about w×h/784 tokens ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)): 1000×1000 = 1,296, so 768² is about 750 |
| Spreadsheet | First 5 sheets, 50 rows each | Applied after parsing |
| Zip entries | 200 names | |
| Skip parse above | Office 25 MB, PDF 200 MB | Protects memory, per the 600 MB result |
| Timeout | 30 s per extractor | |

Include the pipeline and budget version in the answer cache key (section B.4), because changing either changes the model's input.

## B. Storage and caching

### B.1 SQLite: `node:sqlite`

| | `node:sqlite` (default) | `better-sqlite3` 13.0.3 |
|---|---|---|
| Status | Stability 1.2 release candidate ([v24 docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), since v24.15.0). No warning printed on 24.22.1 (spike) | Stable API, 2016, 15.8M/wk |
| SQLite | 3.53.4 | 3.53.4 |
| FTS5 | Spike: yes, including trigram | Spike: yes, including trigram |
| Math functions (`ln`) | Spike: yes | Not tested |
| Install | Nothing | 27 MB, 8 bundled prebuilds |
| Electron 45.2.3 (Node 24.22.2) | Spike: loads | Spike: loads with no rebuild, since v13 moved to [N-API](https://github.com/WiseLibs/better-sqlite3/releases) in 2026-07 |

**Recommendation: `node:sqlite`.** Zero dependencies, nothing to install or rebuild, and the same SQLite engine. Being RC is an acceptable risk because the DB is mostly a rebuildable cache, and it is pinned to the runtime Jevonganize ships with.

Conditions:
- Require Node >=24.22.1, which `officeparser` needs anyway. That also includes the fix for [CVE-2026-58041](https://app.opencve.io/cve/CVE-2026-58041), a `createTagStore` flaw that a distro advisory lists as fixed in 24.18.1.
- It is synchronous with [no async API](https://github.com/yinxulai/one-switch/issues/9), so run it in a worker. In Electron this is needed to avoid freezing the app.
- Bundlers can trip on the `node:` import ([Vite report](https://github.com/vitejs/vite/discussions/19278)). Keep it server-side.
- If the RC API breaks, `better-sqlite3` has a close API and is the fallback.

**FTS5 tokenizer:** use `tokenize='trigram'`. Spike: the default tokenizer found nothing on a Japanese substring and trigram matched. Trigram queries need at least 3 characters.

### B.2 Schema

```sql
CREATE TABLE file (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE,
  dev INTEGER, ino INTEGER, size INTEGER, mtime_ns TEXT, ctime_ns TEXT,  -- bigint stat values
  hash TEXT, mime TEXT, tag_w REAL NOT NULL DEFAULT 0, scanned_at INTEGER
);
CREATE INDEX file_inode ON file(dev, ino);
CREATE INDEX file_hash ON file(hash);

CREATE TABLE tag (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, facet TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1, df INTEGER NOT NULL DEFAULT 0, idf REAL NOT NULL DEFAULT 0
);
CREATE TABLE file_tag (                       -- mirror of the xattrs
  tag_id INTEGER NOT NULL, file_id INTEGER NOT NULL,
  PRIMARY KEY (tag_id, file_id)
) WITHOUT ROWID;
CREATE INDEX file_tag_file ON file_tag(file_id, tag_id);

CREATE TABLE answer (                         -- model output, keyed by content not path
  key TEXT PRIMARY KEY, hash TEXT NOT NULL, preset TEXT NOT NULL,
  value TEXT, confidence REAL, created_at INTEGER
);
CREATE TABLE review (                         -- suggestions awaiting a human
  file_id INTEGER NOT NULL, preset TEXT NOT NULL, value TEXT, confidence REAL,
  PRIMARY KEY (file_id, preset, value)
);
CREATE VIRTUAL TABLE content USING fts5(text, tokenize='trigram');  -- rowid = file.id
```

**Warning:** everything rebuilds from disk except `answer` and `review`, which cost API money to recreate. Treat the DB as a cache for correctness, but do not delete it casually. Consider exporting `answer` for backup.

### B.3 Hashing and fingerprints

Spike, 1 GiB in memory, M1, two runs (blake3 via napi: one run):

| Hash | GB/s |
|---|---|
| `@node-rs/xxhash` xxh3 | 12.1–13.3 |
| `node:crypto` sha256 | 0.84–0.86 |
| `node:crypto` sha1 | 0.87–1.14 |
| `node:crypto` sha512 | 0.51–0.58 |
| `@napi-rs/blake-hash` blake3 | 0.57 |
| `node:crypto` blake2b512 | 0.31–0.50 |
| `hash-wasm` blake3 | 0.27–0.32 |
| `node:crypto` md5 | 0.22–0.30 |

`node:crypto` has no BLAKE3 on Node 24 (spike). **Recommendation: `node:crypto` sha256.** No dependency, and it beat every BLAKE3 option available here. Hashing runs only when a fingerprint changes, on files being read anyway, so xxh3's speed does not justify a native dependency. This M1 has SHA hardware; CPUs without it will be slower.

**Large files (judgement):** at or under 64 MiB, hash the whole file. Above that, hash `size + first 1 MiB + middle 1 MiB + last 1 MiB` and prefix the result `p1:` (whole files get `f1:`), which also versions the scheme. Limit: an edit outside those windows that keeps the size unchanged is invisible to the hash. The mtime still triggers a rescan, but the hash and cached answers would stay. Acceptable for large media.

**Fingerprint behaviour on APFS (spike):**

| Event | mtime | ctime | inode | Watcher | xattrs |
|---|---|---|---|---|---|
| xattr write | same | **changes** | same | `update` on an old file; control file silent | kept |
| Rename | same | changes | same | `delete` + `create` | kept |
| Rename a temp file over it (atomic save) | changes | changes | **changes** | | **lost** |

Note: on a file created seconds earlier, FSEvents reported the xattr write as `create`, so treat event types as hints and re-stat.

**Invalidation rules.** Use `fs.stat(path, { bigint: true })` for nanosecond values.

| Observation | Action |
|---|---|
| dev, ino, size, mtime, ctime all match | Skip |
| Only ctime differs | Re-read xattrs, no hashing |
| size or mtime differs | Rehash, re-extract if the hash changed |
| Path gone, same (dev, ino) elsewhere | Update path |
| New path, known hash | Reuse answers, zero API calls |
| Tags gone, **inode same** | User removed them. Respect that |
| Tags gone, **inode changed** | Atomic save stripped them. Reapply if the hash is unchanged, otherwise send to review |
| After Jevonganize writes tags | Record the new ctime at once, or the app re-triggers itself |

Atomic-save tag loss is the biggest design risk found. Editors that save by rename can silently erase the source of truth, and the DB is the only recovery path. How many real apps do this was not measured.

### B.4 Answer cache key

```
key = sha256(provider | model | modelVersion | presetHash | promptVersion | pipelineVersion | contentHash)
```

Use one row per preset, not per file. Then a schema change invalidates only the presets that changed (section D.6). `presetHash` covers the definition text and allowed values, but not bucket edges or aliases, which are applied after the answer.

### B.5 Scanning and watching

**Spike, 99,000 files, warm cache, two runs:** `fs.readdir` recursive took about 185 ms, sync `statSync` with bigint 264–598 ms, async `stat` at 64-way concurrency 790–1,159 ms. Under a second for a full warm rescan, and sync in a worker beat async. Cold-disk and network volumes will be much slower.

**Recommendation:** full stat-and-compare at startup (simple and always correct), plus `@parcel/watcher` for live changes. `getEventsSince` snapshots worked in spike, but skip them until a library exceeds about 1M files.

| | `@parcel/watcher` 2.6.0 | `chokidar` 6.0.0 |
|---|---|---|
| Age, scale | 2018, 57.9M/wk | 2012, 274.6M/wk |
| Mechanism | Native recursive backends, batched in C++ | JS over `fs.watch` |
| Install | Prebuilt optional deps; worked with pnpm scripts blocked (spike) | Pure JS |
| Large trees | Built because of chokidar's file-descriptor and crawl problems ([Parcel comment](https://github.com/vitejs/vite/issues/2547)) | Slower start |

`chokidar` has more downloads, but a folder-scanning tool's workload is exactly its weak point, and `@parcel/watcher` is the native design with 58M/wk. Linux inotify watch limits and xattr events on Linux and Windows were not tested.

### B.6 Thumbnails

Layout: `<cache>/thumbs/<hash[0:2]>/<hash>-256.webp`, written to a temp file and renamed.

The [freedesktop spec](https://specifications.freedesktop.org/thumbnail/latest/thumbsave.html) gives useful practice: sizes [128/256/512/1024](https://specifications.freedesktop.org/thumbnail/latest/directory.html), temp-then-rename, and a `fail` record. It keys on MD5 of the URI and [checks mtime and size](https://specifications.freedesktop.org/thumbnail/latest/modifications.html). Keying on content hash instead means renames and duplicates cost nothing and invalidation disappears. Store failures as a DB row with the generator version, so a better extractor retries them.

Content-addressed URLs also allow `Cache-Control: immutable`, so the browser cache does the rest.

### B.7 How fast apps stay fast

| App | Technique | Take for Jevonganize |
|---|---|---|
| [Everything](https://www.voidtools.com/faq/) | Reads NTFS MFT, follows USN journal, needs admin | Not reachable from Node. Principle: never re-walk when a change feed exists |
| [fd](https://github.com/sharkdp/fd) | Parallel traversal, skips hidden and gitignored | Skip ignored paths by default |
| [Czkawka](https://git.blob42.xyz/Archives/czkawka/blame/commit/9fd3fb376ef7e14f4eda19ba159a591478cfde45/instructions/Instruction.md) | Per-algorithm caches, optional prehash cache, stale-entry removal | Key caches by algorithm version |
| [digiKam](https://docs.digikam.org/en/setup_application/database_settings.html) | Separate regenerable DB for thumbnails, found [by hash or path](https://bugs.kde.org/show_bug.cgi?id=267131) | Same split, content-keyed |
| [Eagle](https://developer.eagle.cool/plugin-api/api/item) | Per-item metadata and thumbnail next to the original (layout only from a reverse-engineered source) | Precomputed thumbnails |
| [TagSpaces](https://docs.tagspaces.org/tagging/) | No DB; tags in filename or `.ts` sidecar; sidecars break on outside moves | Shows why xattrs are attractive, and why a cache is needed for speed |
| Spotlight | [Importer plug-ins](https://developer.apple.com/library/archive/documentation/Carbon/Conceptual/MetadataIntro/MetadataIntro.html) extract metadata into an index. Internals not confirmed from the source read | Same shape as this pipeline |

### B.8 Browsing 100k files

- Serve pages from SQLite with keyset pagination (`WHERE (sort_key, id) > (?, ?) LIMIT 200`), never `OFFSET`.
- Use `@tanstack/virtual-core`: [headless, covers plain JS and major frameworks, grid via two axes](https://tanstack.com/virtual/latest/docs/introduction). Use fixed row heights, and lay grids out as rows of N.
- Load thumbnails lazily by URL, and generate on first view.

## C. Similarity

### C.1 Options

| Method | Rare tags count more | Per-facet weights | Fast via inverted index | Verdict |
|---|---|---|---|---|
| Jaccard | no | no | yes | Too crude: `lang:en` counts as much as `project:acme` |
| **IDF-weighted Jaccard** | yes | yes | yes | **Pick** |
| IDF cosine | yes | yes | yes | Similar ranking, adds a square root, harder to explain |
| Tversky | only if weighted | possible | yes | [α=β=1 is Jaccard](https://en.wikipedia.org/wiki/Tversky_index). The asymmetry knob has no use case yet |
| BM25 | yes | possible | yes | Built for long queries against documents with term frequency. Tags are binary, so most of it does nothing |
| MinHash | no | hard | yes | For scale we do not have: exact takes tens of ms at 100k |
| Embeddings | semantic | no | needs a vector index | Not needed for tag similarity. Good later add-on: `sqlite-vec` 0.1.9 (1.67M/wk, pre-1.0) loaded into `node:sqlite` with `allowExtension: true` (spike), and `@huggingface/transformers` 4.3.2 could embed locally (not tested) |

### C.2 Formula

```
w(t)   = idf(t) × facetWeight(facet(t))
idf(t) = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))        (BM25 idf)

sim(A,B) = Σ w(t) for t in A∩B  /  ( W(A) + W(B) − Σ w(t) for t in A∩B )
           where W(X) = Σ w(t) for t in X
```

Scores run 0 to 1, it is symmetric, it needs no tuning beyond facet weights, and a file with one rare shared tag beats a file with three generic ones. The [BM25 idf](https://en.wikipedia.org/wiki/Okapi_BM25) form stays positive even for tags on most files.

Starting facet weights (judgement): `project` 2, `party` 1.5, `type` 1.5, `topic` 1.5, `date` 1, `language` 0.25, `sensitivity` 0.25. Use 0 for exact numeric tags, which are unique by nature and would otherwise look highly significant.

### C.3 Worked example

N = 100,000. Query A = `type:invoice`, `format:pdf`, `project:acme`, `year:2024`, `lang:en`.

| Tag | df | idf | Facet weight | w |
|---|---|---|---|---|
| project:acme | 120 | 6.72 | 2 | 13.44 |
| project:zeta | 80 | 7.12 | 2 | 14.25 |
| type:contract | 2,500 | 3.69 | 1.5 | 5.53 |
| type:invoice | 4,000 | 3.22 | 1.5 | 4.83 |
| year:2024, year:2023 | 9,000 | 2.41 | 1 | 2.41 |
| format:pdf | 30,000 | 1.20 | 0.5 | 0.60 |
| lang:en | 70,000 | 0.36 | 0.25 | 0.09 |

W(A) = 21.37.

| File | Tags | Plain Jaccard | Weighted | Rank by weighted |
|---|---|---|---|---|
| B | type:contract, format:pdf, project:acme, year:2023, lang:en | 0.429 | 14.13 / (21.37 + 22.07 − 14.13) = **0.482** | 1 |
| C | type:invoice, format:pdf, project:zeta, year:2024, lang:en | 0.667 | **0.223** | 2 |
| D | format:pdf, lang:en, year:2024 | 0.600 | **0.145** | 3 |

Plain Jaccard ranks B last. Weighted ranks the same-project contract first, which is what a user means by "similar". (`format:` is here only for illustration; D.3 keeps it out of on-disk tags, though it can still live in the DB and be weighted.)

### C.4 SQL

```sql
-- after each scan
UPDATE tag SET df = (SELECT count(*) FROM file_tag WHERE tag_id = tag.id);
UPDATE tag SET idf = ln(1 + (:N - df + 0.5) / (df + 0.5));
UPDATE file SET tag_w = coalesce((SELECT sum(t.idf * t.weight) FROM file_tag ft
  JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = file.id), 0);

-- query
WITH q AS (SELECT ft.tag_id, t.idf * t.weight AS w FROM file_tag ft
           JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = :id),
     qs AS (SELECT sum(w) AS s FROM q),
     hits AS (SELECT f.file_id, sum(q.w) AS inter FROM q
              JOIN file_tag f ON f.tag_id = q.tag_id
              WHERE f.file_id <> :id GROUP BY f.file_id)
SELECT h.file_id, h.inter / (qs.s + n.tag_w - h.inter) AS score
FROM hits h JOIN file n ON n.id = h.file_id, qs
ORDER BY score DESC LIMIT 50;
```

**Spike:** synthetic 100k files, 731k assignments, 2,000 skewed tags, top tag on 45,604 files, SQLite 3.53.4 via `node:sqlite`, with a slightly simplified table layout.

| Variant | p50 | p95 | Top-50 overlap with exact |
|---|---|---|---|
| Exact | 24–45 ms | 60–107 ms | 1.00 |
| Skip tags on over 20% of files as candidates | 7–9 ms | 22–34 ms | 0.80 |
| Skip tags on over 5% of files | 6 ms | 13 ms | 0.73 |

idf refresh took about 40 ms and the `tag_w` rebuild 420–720 ms. **Use the exact query.** The cap loses 20–27% of the top 50, and exact is already fast enough. Add the 20% cap only past about 500k files. Real tag distributions will differ from this synthetic data.

Stale idf between scans is harmless because it drifts slowly.

## D. Taxonomy and classification

### D.1 Facets, not flat tags

[Faceted classification](https://en.wikipedia.org/wiki/Faceted_classification) combines independent categories instead of placing each item in one tree, and later free-faceted schemes let absent facets simply be omitted. That matches files: an invoice has a type, a party and a date, and needs no slot for anything else. **Use facets.** A flat list also cannot enforce "one value per facet", which is what makes model output checkable.

| Tradition | What to take | What to leave |
|---|---|---|
| Ranganathan PMEST | Independent facets; the Personality, Matter, Energy, Space, Time checklist | Notation |
| [Dublin Core](https://www.dublincore.org/specifications/dublin-core/dces/) | Facet names: Type, Subject, Creator, Date, Language, Coverage, Rights. Use a controlled vocabulary for Type and Subject | The other 8 elements, mostly filesystem data already |
| [DCMI Type](https://www.dublincore.org/specifications/dublin-core/dcmi-type-vocabulary/) | Shows format and type are separate questions | Too coarse for `type` values |
| [PARA](https://fortelabs.com/blog/para/) | Organise by actionability: a `status` facet (active, reference, archive) | Folder layout |
| [Johnny Decimal](https://johnnydecimal.com/10-19-concepts/11-core/11.01-introduction/) | "No more than 10" per level, for the catalogue layout | Numeric IDs |
| [ISO 15489](https://standards.iteh.ai/catalog/standards/iso/baf32a1d-182a-428d-aca9-74f0e33d01a7/iso-15489-1-2016) | Classification links to retention. Only summaries were read | Compliance process |
| Data classification ([DU](https://www.du.edu/sites/default/files/2023-01/IT%2013.10.051%20Data%20Classification.pdf), [WMU](https://wmich.edu/policies/data-classification)) | Public, internal, confidential, restricted. Close to [Purview defaults](https://learn.microsoft.com/purview/default-sensitivity-labels-policies) | |
| [Z39.19](https://marciazeng.metadataetc.org/Z3919/2principle.htm) | One preferred term per concept; USE and UF cross-references | Full thesaurus relations |
| Folksonomy ([Golder & Huberman](https://dl.acm.org/doi/abs/10.1177/0165551506062337), [Flickr study](https://www.ra.ethz.ch/cdstore/www2008/www2008.org/papers/xhtml/fp302/fp302-sigurbjornsson.html)) | Power-law use: the head is generic and the tail is one-offs. Keep user tags, and promote what proves useful | Unmoderated model-invented tags |

**Hybrid:** closed vocabularies for most facets, and open values only in `topic`, `party` and `project`, which go through a candidate stage (D.5). [SemEval-2025 LLMs4Subjects](https://arxiv.org/pdf/2504.07199) systems point the same way: [generate terms, then map them to the vocabulary](https://aclanthology.org/2025.semeval-1.148.pdf), since free generation drifts.

### D.2 Tags per file

| Source | Finding |
|---|---|
| [LoC SHM H 180](https://www.loc.gov/aba/publications/FreeSHM/H0180.pdf) | "Generally, a maximum of six is appropriate"; "Do not assign more than ten"; topics must be at least 20% of the work |
| [Flickr, 52M photos](https://www.ra.ethz.ch/cdstore/www2008/www2008.org/papers/xhtml/fp302/fp302-sigurbjornsson.html) | 64% have 1–3 tags |

**Rule (judgement, based on those):** aim for **3–6 tags per file, hard cap 10.** At most 1 value per single-valued facet, at most 3 for multi-valued. Apply the 20% rule in the `topic` prompt: tag a topic only if it covers about a fifth of the file. Skip anything the filesystem already knows (extension, size, mtime); it can live in the DB.

### D.3 Representing attributes as tag strings

Grammar: `facet:value`, lowercase ASCII kebab-case where the language allows (Unicode allowed for names), `/` for hierarchy, 64 chars max. **No commas or newlines:** Linux [`user.xdg.tags` is comma-separated](https://lists.freedesktop.org/archives/xdg/2016-November/013794.html) and not formally specified. Spike: `doc-type:invoice` and `topic:finance/tax` round-tripped through `_kMDItemUserTags` and were picked up by Spotlight's importer. Finder display and `mdfind` queries were not confirmed.

| Kind | Encoding | Example | Rule |
|---|---|---|---|
| Binary | Presence only | `flag:has-signature` | Absent means false or unknown. Keep that distinction in `answer`, not on disk |
| Categorical | One value | `doc-type:invoice` | Closed list in the schema |
| Hierarchical | Leaf only on disk | `topic:finance/tax` | Expand ancestors (`topic:finance`) in the DB, so parents match at lower idf with no extra disk tags |
| Numeric | Bucket, log-scale | `amount:1k-10k`, `pages:11-50` | Edges defined in the schema. Exact value stays in `answer` |
| Numeric, exact needed | Value | `amount:1200` | Opt-in only, facet weight 0 |
| Date | ISO 8601 truncated to useful precision | `doc-date:2026-03` | Sorts as a string. Expand `doc-date:2026` in the DB |

Numeric bucketing keeps cardinality low enough for filters and similarity. Exact values on every file would produce 100k unique tags and flood Finder's tag list.

### D.4 A ~100 preset catalogue

10 groups of up to 10 presets, following the "no more than 10" rule. Users enable packs, and each file is classified only against enabled presets whose `appliesTo` matches, which keeps prompts small.

| # | Group | Examples |
|---|---|---|
| 1 | Core | doc-type, topic, language, status |
| 2 | Time | doc-date, period, event-date |
| 3 | Parties | party, person, organisation, role |
| 4 | Projects | project, area, client |
| 5 | Finance | invoice-state, amount, currency, tax-year |
| 6 | Legal and records | contract-type, retention, record-class, jurisdiction |
| 7 | Sensitivity | sensitivity, has-pii, has-credentials, has-health-data |
| 8 | Media | scene, is-screenshot, subject-count, audio-kind |
| 9 | Work and code | language-code, doc-purpose, audience |
| 10 | Housekeeping | quality, likely-duplicate, keep-or-delete |

```json
{ "id": "doc-type", "group": "core", "version": 3, "kind": "categorical",
  "cardinality": "one", "values": { "invoice": "Request for payment...", "contract": "..." },
  "aliases": { "bill": "invoice" }, "appliesTo": ["application/*", "text/*", "image/*"],
  "weight": 1.5, "reviewBelow": 0.85 }
```

Each value carries a one-line definition, since that text is the actual classifier prompt.

### D.5 Low confidence and the tag lifecycle

Do not rely on a model's self-reported confidence alone: [Xiong et al.](https://arxiv.org/abs/2306.13063v2) found verbalised confidence tends to be overconfident, and sampling consistency does better. I found no study of calibration for LLM tagging specifically.

**Rules (thresholds are starting assumptions; calibrate per preset from accept and reject rates):**
1. Every preset offers `unknown`. Abstaining is a valid answer and is not written.
2. Require a short evidence quote; drop the answer if it is not in the extracted text.
3. Use token logprobs where the provider has them. Otherwise take a second sample only for borderline answers on sensitive presets.
4. Confidence ≥ 0.85: write. 0.50–0.85: review queue, not written. Below 0.50: discard.
5. Sensitivity runs the other way: a missed `restricted` costs more than a false alarm, so suggest the higher level for review whenever in doubt.
6. Review groups by tag, not file ("confirm these 40 as invoices"), and each decision feeds the threshold.
7. **Humans always win.** Any tag not in the last AI write is treated as human and never removed. Record the last AI write in a second xattr, or provenance dies with a DB rebuild.

**Tag lifecycle:** `proposed` (open facet, DB only) → `active` (at 5+ files or user approval) → `deprecated` (alias to preferred term, the Z39.19 USE/UF model) → `retired`.

Run a periodic cleanup report: near-duplicates by edit distance, tags on one file, tags on over 50% of files (no discrimination), and tags unused since the last schema version. [Z39.19](https://marciazeng.metadataetc.org/Z3919/8Z3919toc.htm) treats maintenance and term deletion as part of the vocabulary's life.

### D.6 Re-tagging on schema change

Because answers are cached per preset (B.4), most changes need no model call.

| Change | Model calls | Action |
|---|---|---|
| Rename value or add alias | 0 | Rewrite tags |
| Merge values | 0 | Alias old to new, rewrite |
| Change bucket edges | 0 | Recompute from cached exact answers |
| Add preset | New preset only | Lazy, or on request, with a cost estimate first |
| Split value | Only files holding the old value | Scoped re-ask |
| Change definition text | Files in that preset's scope | New `presetHash` |
| Remove preset | 0 | Remove AI-written tags; leave human ones |
| New model | 0 by default | Opt-in. Spot-check a sample before a full rerun |

Always show the affected count and estimated cost first, and write in batches so a run can resume.

## Not verified

- `.msg` parsing (the `@kenjiuno/msgreader` import loads, but no file was parsed), `soffice`, `ffmpeg` frames, and video containers in `music-metadata`. No Windows or Linux spikes were run.
- `officeparser` was tested only on tiny fixtures. Try real, messy office files before committing.
- Finder display of `facet:value` tags, and Spotlight queries against them.
- How many real apps strip xattrs on save.
- The SheetJS status comes from one secondary source. The Spotlight internals, Eagle layout and ISO 15489 text were not confirmed from primary sources.
- Timings are from one M1 machine with warm caches. Ranges span repeat runs; the machine was shared with other agents, so treat them as rough.

## Spike reproduction

Scripts are in the session scratchpad and are not committed. npm data came from `registry.npmjs.org` and `api.npmjs.org/downloads` on 2026-11-06.
