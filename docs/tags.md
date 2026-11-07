# Tags

A tag is one flat string, stored by the operating system on the file. Tags on disk are the source of
truth. `core/tags.ts` is the only module that reads or writes them, and its interface is the same on
every OS. See [contracts](contracts.md#tags-coretagsts).

**Test status.** The macOS behaviour below was tested on macOS 14 with APFS, HFS+, exFAT and FAT32.
CI also runs the real backends on `ubuntu-latest` and on `windows-latest` (Windows Server 2025, NTFS):
tags are written, read back and removed there, and "tested in CI" below means exactly that. CI proves
test behaviour only. Explorer, Dolphin, Baloo and packaged Windows and Linux apps are unverified.

## Grammar

```text
tag      = facet-tag | flag-tag | plain-tag
facet-tag = <facet id> ":" <label>       doc-type:invoice
flag-tag  = "flag:" <facet id>           flag:has-signature
plain-tag = any allowed string           to-read
label     = part ("/" part)*             topic:finance/tax
```

- The first `:` separates facet from label. A later `:` is part of the label.
- `/` marks hierarchy. Only the leaf is stored: `topic:finance/tax`, never also `topic:finance`.
- A date label is ISO 8601 cut to its precision: `doc-date:2026` or `doc-date:2026-03`.
- Facet ids and generated labels are lowercase kebab-case where the language allows. Unicode is
  allowed in names: `party:山田商事`.
- A generated tag is at most 64 characters. A person's tag has no such limit.
- If the part before the first `:` is not a known facet id, the tag is plain. `tag.facet` is then
  null, and the whole string is still treated as one tag.

`/` and `:` mean something only inside Jevonganize. On disk, `year/2024` is an ordinary plain tag.

## Portable encoding

These rules apply on every OS, even where a store would allow more. That keeps behaviour identical.

| Rule | Value | Why |
| --- | --- | --- |
| Forbidden | Control characters, and `,` `;` `"` `\` `*` `?` | `,` is the Linux separator, `;` is the Explorer separator, a newline breaks the macOS format, and the rest is Spotlight query syntax |
| Normalization | Unicode NFC, then trim. On read and on write | macOS stores NFC and NFD as different tags |
| Case | Preserved. Unique ignoring case, and the first spelling wins | macOS keeps `Upper` and `upper` as two tags |
| Order | Sorted by code unit | Tags are a set |
| Size | 2,048 UTF-8 bytes per file, joined with `,` | Fits ext4's single block with room to spare |
| Emoji | Allowed, including joined sequences | The forbidden class is `\p{Cc}` only, so the zero-width joiner survives |

`normalize()` applies NFC, trim, uniqueness and order. `writeTags()` also rejects a set that breaks a
rule, and writes nothing. The file keeps the tags it had.

**A foreign tag can block a write.** Finder allows `a,b`. `readTags()` returns it, but any later
write of a set that still contains it fails, and the failure is recorded on that plan op. The fix is
to rename the tag with `rename_tag`. That removes the bad spelling, so the write succeeds.

**Warning on `:`.** One third-party source says colons in tags caused problems on some macOS versions.
`fiscal-year:FY2025` worked on macOS 14 through `NSURL`, `mdls` and `mdfind`. It has not been checked
in Finder's window or on other versions.

## Where tags are stored

| OS | Store | Format | Shown by |
| --- | --- | --- | --- |
| macOS | xattr `com.apple.metadata:_kMDItemUserTags` | Binary plist array of `name\ncolour` | Finder tags and Spotlight |
| Linux | xattr `user.xdg.tags` | UTF-8, joined with `,` | KDE Dolphin and Baloo |
| Windows | NTFS stream `:jevonganize.tags` | UTF-8, joined with `,` | Nothing. See below |

An empty set deletes the attribute or stream.

- **macOS:** existing Finder colours are kept. Jevonganize does not model them. A write also clears
  the legacy colour bits in `com.apple.FinderInfo` byte 9, or a removed tag can come back as a
  colour tag. Other FinderInfo bytes are kept. The format is private to Apple, and only
  `NSURLTagNamesKey` is documented. It has been stable, and Dropbox depends on it, but Apple
  promises nothing.
- **Linux:** `user.xdg.tags` is a KDE convention, not a specification.
- **Windows:** streams need NTFS or ReFS. Paths must be absolute. Paths past `MAX_PATH` work (tested
  in CI).

`supported(path)` writes a throwaway probe file once per volume and reads it back. The result differs
by OS even for one file system: exFAT works on macOS through `._` sidecar files, and is expected to
fail on Linux and Windows. When it is false, the UI says so and offers no tag actions there.

Tag writes do not follow symlinks.

## What you will and will not see

Be clear about this before relying on it.

| Environment | Tags in the file manager | OS search |
| --- | --- | --- |
| macOS Finder | Yes. Reads through `NSURL`, `mdls` and Spotlight were tested. The Finder window itself was not visually checked | Yes, through Spotlight. Case-sensitive by default |
| Linux, KDE Dolphin | Yes, expected, not tested. `/` nests tags under `tags:/`, with open bugs on deep nesting | Baloo |
| Linux, GNOME Files | **No. Shows nothing.** GNOME has no user tags | No |
| Windows Explorer | **No. Shows nothing, on any file.** Windows Search cannot find them either | No |

On Windows and GNOME, use the Jevonganize app to see and search tags. Tags are still on the files.

Windows has no tag that works for every file type. Explorer's "Tags" field exists only where a
handler supports the format, and it rewrites the file's content. PDF and plain text have none by
default. One stream for every file is the only option that behaves the same for all files and leaves
content untouched. A signed property handler could show the same stream in Explorer later. It is out
of scope for now.

## What survives

Tags are fragile by nature. They live beside a file's bytes, not inside them. Microsoft moved away
from this design in Vista for that reason. Jevonganize accepts the trade-off, and makes loss visible
through [lost tags](#lost-tags).

Tags do not cross operating systems. The three stores are separate, so a file moved from a Mac to
Linux loses them in practice.

| Action | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Rename or move, same volume | Kept (tested) | Kept (expected) | Kept (tested in CI) |
| `cp`, `ditto`, Finder copy | Kept by `cp` and `ditto` (tested). Lost by `cp -X` | Lost unless `cp --preserve=xattr` (not tested) | Explorer copy, NTFS to NTFS: reported kept |
| Copy to exFAT or FAT | Kept in a `._` sidecar (tested). Lost if only the main file is taken elsewhere | Lost: no xattrs there | Lost, after a warning from Explorer (reported) |
| `rsync` | Kept with `-aE`, lost with `-a` (tested) | Needs `-X` (not tested) | Not applicable |
| `tar` | Kept by bsdtar, macOS to macOS (tested) | Not tested | Not tested |
| `zip`, then `unzip` | **Lost** (tested). `ditto -c -k` then `ditto -x -k` keeps them | Expected lost | **Lost** (reported) |
| Email or upload | Expected lost | Expected lost | **Lost** (reported) |
| `git clone` or checkout | **Lost** (tested). Git stores no attributes | Expected lost | Expected lost |
| Save by writing a temp file and renaming | **Lost** (tested, also `sed -i`) | Expected lost | **Lost** with a plain rename (tested in CI). Those using `ReplaceFile` are reported to keep streams |
| Save over the open file's bytes | Kept (tested) | Expected kept | Kept (tested in CI) |
| Save by recreating the file (`fopen(path, "w")`, Node `fs.writeFile`) | Kept (tested) | Expected kept | **Lost** (tested in CI). `CREATE_ALWAYS` deletes every stream and keeps the file id |
| Node `fs.copyFile`, `fs.cp` | **Lost** (tested) | Not tested | Kept (tested in CI) |

Sync services were not tested.

| Service | What is known |
| --- | --- |
| iCloud Drive | Reported kept, including evicted files. Third-party source |
| Dropbox | Its documentation lists macOS tags as synced. A `:jevonganize.tags` stream is probably not |
| Google Drive | Reported lost, in one forum post |
| OneDrive | No source found |
| NFS and network shares | "Not always preserved". NFS needs v4.2 on both sides |

## Merge on write

A write can never lose a tag set elsewhere. To apply one op on one file:

1. Read the tags from disk with `readTags`. Do not trust the mirror.
2. Compute `(disk ∪ add) − remove`.
3. If the result equals the disk set, stop.
4. Call `writeTags` with the result.
5. Update the mirror and the stored fingerprint at once, so `watch` does not treat the write as an
   outside change. That hides any tag that left the file since the last scan, so handle those here
   as the scan would: a tombstone for an AI tag, or a `restore` item if the file was replaced.
6. Replace the op in the stored plan with what really changed, so undo reverses only that. The
   change is recorded as soon as it is written, so a crash loses no undo.

Undo is the same merge with `add` and `remove` swapped. A tag added by someone else after the plan
ran stays. A restored tag keeps the provenance its plan implies: an organize plan removed an AI tag,
so it comes back with `ai = 1`. A cancelled or partly failed undo leaves the plan `applied`, holding
only the ops still to reverse.

There is no lock. An edit that lands between steps 1 and 4 can be lost. The window is a few
milliseconds per file, and no OS offers an atomic alternative.

A failed write is recorded in `plan.errors` for that file, and the rest of the plan continues.

## Virtual folders

A [virtual folder](concepts.md#virtual-folders) is a rule over tags, kept in the index. It writes
nothing to disk, and only its tags put a file in it. So dropping a file on a folder, or
`folders put`, is a tag change: `add_to_vfolder` stores a plan that adds the folder's home tag, and
the home tag of each folder above it that has one. Taking a file out, `remove_from_vfolder`, plans
removing only the folder's own home tag. Both run through `apply_plan` and the merge above, so they
can be seen first and undone, and they are a person's tags, not AI ones. A file that still matches
through another tag, such as a child `topic:finance/tax` under `topic:finance`, stays in the folder.

## Hierarchy

`/` in a label makes a tree: `topic:finance/tax` sits under `topic:finance`. The rules:

1. **The tag string on the file is the truth.** No table holds a parent. The tree is the prefix
   relation between names, so it cannot hold a cycle, and it survives on another machine and in
   Finder exactly as written.
2. **The tree is derived.** `list_tag_tree` builds it from the names in the index on each call. A
   node counts `direct`, the files carrying that exact tag, and `total`, the files carrying it or a
   tag under it. A node no file carries itself, such as `topic:finance` above, is `implicit`, with a
   `direct` of 0. `core/tag-tree.ts` builds the tree in memory from one read of every file's tag
   ids, in `core/db/tag-tree.ts`, and counts each file once under each node above its tags. So a
   node's `total` is what filtering by it finds, except that a year's months, which search also
   matches, sit beside the year in the tree rather than under it.
3. **A facet is the root.** `topic:` is the root of every `topic:` tag, and the label's `/` parts
   are the levels under it. Plain tags make trees by `/` too, with no root above them. A `flag:`
   tag is a leaf of its own. Nothing moves from one facet to another, or between a facet and plain
   tags.
4. **Only open facets and plain tags move.** An open facet, such as `topic`, `party` or `project`,
   grows its values in the vocabulary, so a new path is a value it can hold. A closed facet's labels
   are fixed by its preset, so moving one would make a label it does not define, and is refused.
5. **A label is at most 6 levels deep.** A move that would take any tag under it deeper is refused.
   The 64-character limit stays for generated tags only. A person's move has none.

Every change to the tree is a plan, so it can be seen first and undone:

| Operation | Example | What the plan does |
| --- | --- | --- |
| Move under a parent | `topic:tax` under `topic:finance` | Renames `topic:tax` and `topic:tax/vat` to `topic:finance/tax` and `topic:finance/tax/vat` |
| Move to the top | `topic:finance/tax` to the top | Renames it, and its children, to `topic:tax` |
| Rename with children | Implicit `topic:finance` to `topic:money` | Renames the prefix of every tag under it |
| Merge into a parent | `topic:finance/tax` into `topic:finance` | `rename_tag` without children |
| Drop a redundant parent | `topic:finance` and `topic:finance/tax` on one file | `cleanup_report` lists it in `redundant_parents`. A plan removes only the parent |

A move whose new name is already a tag merges into it, and the plan says how many files merge where.
Moving a tag under itself or under one of its own children is refused.

**What follows a rename.** `move_tag` and `rename_tag` with `children` store the rename in
`Plan.renames`. When the plan is applied, after its ops, the state that names the old paths follows:

- The vocabulary: the old path is retired and the new one turned active, so organize answers with the
  new path and never suggests the old one again.
- Virtual folders: their rules and home tags.
- Favorite tags: a starred tag keeps its place under its new name.

Undoing the plan puts all three back as they were. `[tag_colors]` is not rewritten. Colours are inherited
from the parent in the UI, so a moved tag takes the colour of where it now is.

## AI provenance

`file_tag.ai` is 1 when the app wrote the tag: an applied AI answer, or a `field` value from metadata.

- **A tag not recorded as AI is human, and is never removed by Jevonganize on its own.** Only a plan
  that a person approved can remove it.
- Organize may replace or remove a tag with `ai = 1`, when a new answer no longer supports it. That
  change still appears in a plan.
- A tag a person accepted from review is stored with `ai = 0`. They vouched for it.
- A tag found on disk during a scan is stored with `ai = 0`.
- A `field` tag is stored with `ai = 1`, so it can follow the metadata when that changes.
- When a person removes a tag with `ai = 1`, a `rejected` review row keeps it from coming back. If
  they undo that removal, the row goes.
- A person who removes an AI tag and adds it back owns it from the next scan, so an older organize
  plan refuses to remove it.
- If a person adds an AI tag's exact string, the row stays `ai = 1`. The strings cannot be told apart.

**If the index is lost, all tags count as human.** Nothing on disk marks a tag as AI. This only ever
errs towards keeping a tag, which is the safe direction.

If a person removes an AI tag, the scan drops it from the mirror. The stored answer remains, so a
later organize of that file can propose the tag again. It would appear in a plan, never silently.

## Refreshing a tag

A tag you add by hand, or one organize gave only some files, does not reach the rest of the library on
its own. Refresh finds the files that lack it but look like the files that have it, checks them, and
puts the likely ones in the review queue. It is the Refresh button on a tag, and `jevonganize refresh
<tag>`. The tools are `refresh_candidates` and `refresh_tag`; [contracts.md](contracts.md#the-tool-table)
holds the exact rules.

1. **Learn from the tagged files.** Up to 200 files with the tag, or a child of it, most recently
   modified first.
2. **Find candidates, locally and for free.** Three signals point at files without the tag:
   - Words: those common in the tagged files' searchable text and rare across the index, a small
     TF-IDF. The full-text index finds files holding them, and the tag's own words count too.
     Japanese and Chinese words of two characters are joined into compounds such as 請求書, since
     the trigram index needs three.
   - Tags that go with it: tags on its files more often than chance, weighted by how often they go
     with it and by the IDF that [similarity](storage.md) uses.
   - Similar files: the nearest neighbours of the first 10 tagged files.

   A word of the tag in a file name adds a little. The best 50 make the list, 200 at most.
3. **Skip what was handled.** A file with any review item for the tag, open, accepted or rejected, is
   out. So is a file with another value of the tag's facet, when that facet holds one value per file,
   and a file whose unchanged content was already checked for this tag.
4. **Estimate**, as organize does, before anything is sent.
5. **Check each candidate with the decision model**: one yes-or-no question, whether the file should
   carry the tag, with the facet's own definition when the tag is a facet label. This is the
   `[provider]` model organize uses, or the facet's profile, never the chat or names model. Answers
   are cached, so the same content is never paid for twice.
6. **Review.** A yes at or above `thresholds.review` becomes a review item, with a reason naming the
   signals that found it. Accepting builds a plan, and applying it writes the tag with `ai = 0`, as
   any accepted review item. Rejecting keeps the file out of later refreshes.

Nothing is written to a file until a person accepts.

Only organized files have searchable text, so the words signal finds only those. A file that was never
organized is read when it is checked.

## Lost tags

Many apps save by writing a temp file and renaming it over the original. That gives the file a new
inode and drops its tags, on macOS and Windows at least. How many real apps do this was not measured.

On Windows a plain save loses tags too: recreating a file with `CREATE_ALWAYS` deletes every stream and
keeps the file id. So there, a changed `mtime` or size with fewer tags counts as a new inode below.
Removing only the stream never moves `mtime`, so that still reads as a person's choice.

A scan handles a path that already has a row in the index like this:

| Inode | Tags on disk versus mirror | Meaning | Action |
| --- | --- | --- | --- |
| Same | Fewer | A person removed them | Update the mirror. Respect it |
| New | Same or more | Normal save | Update the mirror |
| New | Fewer | A save probably dropped them | Update the mirror, and add one `restore` review item per missing tag |

The mirror always follows the disk, so the tags on disk stay the truth. The `restore` item is the
only record of what was lost.

**Restoration is never silent.** A new inode can also mean you replaced the file with a different
document, so a person decides. Accepting an item merges the tag back through a normal write, with
`ai = 0`. Accepting or rejecting deletes the item, so losing the tag again raises a new one. An item
whose tag is back on the file is dropped.

A volume with unstable inode numbers can raise false items. They cost one click and cannot change
any tags.

## Windows file times

On Windows, writing a stream updates the file's modified time, and removing one does not (both tested
in CI). That would trigger backup and sync tools, and make every tagged file look edited.

So after a stream write or removal, `core/tags.ts` restores the time:

1. `stat` the file before the write, as `bigint`.
2. Write or remove the stream.
3. Call `SetFileTime` with the old `atime` and `mtime`.
4. `stat` again, and store that result as the fingerprint.

Step 3 is not `fs.utimes`, which takes milliseconds. Windows keeps 100 ns ticks, so `utimes` cut the
time short, and the file looked edited to `apply_plan` and to the next scan. `mtime` now comes back to
the tick (tested in CI). `ctime` still moves. macOS and Linux leave `mtime` alone.

## Change detection

A tag write changes `ctime` and not `mtime` on macOS. That shapes everything here.

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| `mtime` on a tag write | Unchanged (tested) | Unchanged (tested in CI) | Changes, then restored exactly (tested in CI) |
| `ctime` on a tag write | Changes (tested) | Changes (tested in CI) | Changes (tested in CI) |
| Event source | FSEvents | inotify `IN_ATTRIB` | `ReadDirectoryChangesW` |

**Why `fs.watch`.** Built-in `fs.watch` reports every xattr change on macOS (tested). chokidar compares
`size`, `mtime` and inode, so it reports none. `@parcel/watcher` reported only the first, as a
`create`. Both ignore changes that leave `mtime` alone.

The design has three parts:

1. `fs.watch(root, { recursive: true })` for each library.
2. For each event, `stat` the path, compare its [fingerprint](storage.md#fingerprint), and re-read
   tags on a difference. Treat all event types alike: macOS reports xattr changes as `rename`.
3. A full stat walk at startup and every `watch.walk_minutes`, which defaults to 30.

Changes reach the UI in one `files` event at most every 5 seconds. That event follows one refresh of
the similarity numbers, which rewrites every file's weight and so cannot run per change.

The walk is required. inotify needs a watch per directory and misses remote changes,
`ReadDirectoryChangesW` can drop events, and `fs.watch` is unreliable on network file systems.

`fs.watch` picked up tag writes on Linux and Windows in CI, on local volumes. Windows reports them as
`change` on the file itself, never naming the stream. It reports a stream written by another program,
but **no event at all when another program removes a stream**. Only the walk sees that, through `ctime`.

A changed `ctime` means "read again", not "tags changed". It also moves on `chmod` and hard links,
which is harmless.
