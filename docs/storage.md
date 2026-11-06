# Storage

Tags on disk are the truth. Everything here is an index of them, plus answers you paid for. The exact
schema is in [contracts](contracts.md#database-coredbts). `core/db/` holds all the SQL.

The index is one SQLite file, `index.db`, in the data directory. It uses `node:sqlite` in WAL mode,
which needs Node 24.22.1 or later. `node:sqlite` is a release candidate, not yet stable. If its API
breaks, `better-sqlite3` is a close fallback.

## Tables

| Table | Holds | One row is |
| --- | --- | --- |
| `library` | Folders you added | A folder and when it was last scanned |
| `file` | What is known about each file | Its path, fingerprint, content hash, state hash, MIME type, metadata, status and total tag weight |
| `tag` | Every distinct tag | Its text, facet, similarity weight, file count and rarity |
| `file_tag` | The mirror of tags on disk | One tag on one file, and whether an AI answer wrote it |
| `answer` | Raw model output | The answers for one facet and one exact input |
| `file_answer` | Which answer each file uses | A file, a facet and an answer key |
| `review` | Items waiting for a person | A `suggest` or `restore` item for one tag on one file |
| `plan` | Tag changes, past and proposed | One plan as JSON, and its status |
| `vocabulary` | Values of open facets | One value and its state: `proposed`, `active` or `retired` |
| `content` | Full-text search | The text sent for a file, by `rowid` = `file.id` |

`file.status` is `new`, `organized` or `failed`. A scan sets `new` on a changed file. Organize sets
the other two.

## Fingerprint

A scan decides whether a file changed from four values, using `fs.stat(path, { bigint: true })`:

```text
ino, size, mtimeNs, ctimeNs
```

`ctimeNs` is in the rule because a tag write changes `ctime` and not `mtime` on macOS. `ino` catches a
save that replaced the file. Values are stored as decimal strings, since they do not fit a 64-bit
float. `dev` is stored too, because an inode is unique only within a volume.

| Observation | Action |
| --- | --- |
| All four match | Skip |
| Only `ctimeNs` differs | Re-read tags, and update the mirror |
| `size` or `mtimeNs` differs | Re-read tags, and set status `new` |
| `ino` differs at the same path | As above, then check for [lost tags](tags.md#lost-tags) |
| Path gone, same `dev` and `ino` at a new path | Update the path. Tags, answers and history stay |
| Path gone, inode not found | Delete the `file` row and its `file_tag` rows. `answer` rows stay. Not when the whole library now has no files: that may be an unplugged drive, so the rows stay and the scan warns |
| New path | New row, status `new` |

After Jevonganize writes tags, it stores the new fingerprint at once, so it does not react to itself.

## Content hash

`file.hash` is a sha256 of the file's bytes, from `node:crypto`. **It is computed only when a file is
organized**, never during a scan. A scan reads tags and `stat` results, not file contents, so it stays
fast on a large library.

| File size | Hash | Prefix |
| --- | --- | --- |
| 64 MiB or less | The whole file | `f1:` |
| Over 64 MiB | `size`, then the first, middle and last 1 MiB | `p1:` |

The prefix versions the scheme. An edit to a large file that falls outside those windows and keeps the
size is invisible to the hash. That is acceptable for large media.

`file.hash` finds identical files and names their thumbnails. It is not part of the answer key.

## Answer key

```text
key = sha256(provider, resolved model, endpoint, facetHash, state_hash)
```

- **`provider`, `endpoint`:** the provider name and `base_url`, if any.
- **`resolved model`:** the model id after defaults are applied. It is the id you configured, so a
  moving alias such as `jev-latest` keeps its cached answers after the provider updates it. Pin a
  version to avoid this. See [providers](providers.md#pin-a-version).
- **`facetHash`:** covers only what the model sees: `kind`, `instructions`, `values`, `levels` and
  `precision`.
- **`state_hash`:** covers exactly what is sent, before the random marker is added. See
  [pipeline](pipeline.md#how-the-model-state-is-assembled).

One row per facet means a change to one facet re-asks only that facet. Weights, aliases, titles and
thresholds are outside the key, so changing them is free. See
[re-tagging](presets.md#re-tagging).

Because the key follows content and not the path, a moved file or an exact copy with the same name
costs nothing. The name is part of the state, so a renamed file is a new input. Two files with the
same key in one run share one request.

`answer.body` is JSON `Answer[]`, stored as returned, before any threshold. Refusals are stored too. A
damaged row counts as a miss. Rows are kept after a file goes away, so a file that returns is free.
Answers hold labels and numbers, never file content.

## What is rebuildable

| Data | If lost | Costs money? |
| --- | --- | --- |
| Tags on files | Real loss. They are your data | Yes, and human tags cannot be rebuilt |
| `answer`, `file_answer` | Re-asked on the next organize | **Yes** |
| `review` | Middle-band items return from answers. `restore` items are gone for good | Only if answers are also lost |
| `plan` | Undo history is gone. Tags are safe | No |
| `vocabulary` | Accepted open values are forgotten, though tags stay on disk | No, but work is lost |
| `file_tag.ai` | [All tags count as human](tags.md#ai-provenance) | No |
| `library` | Add your folders again | No |
| `file`, `tag`, `file_tag` rows | Rebuilt by the next scan | No |
| `content` | Rebuilt by the next organize, from cached answers and fresh extraction, with no model call | No |
| Thumbnails | Rebuilt on demand | No |
| `<cache dir>/compile` | Rebuilt by the next CLI run, which starts slower once | No |

So do not delete `index.db` casually. It is safe for your tags, but it is not free.

An index written by a newer version is refused, never altered. `PRAGMA user_version` holds the schema
version.

## Thumbnails

```text
<cache dir>/thumbs/<key[0:2]>/<key>-256.webp
<cache dir>/thumbs/<key[0:2]>/<key>-1024.webp
```

- `key` is `file.hash` with its prefix removed. A file not yet organized has no hash, so it uses the
  sha256 of `dev`, `ino`, `size` and `mtimeNs`.
- Files are written to a temp name, then renamed.
- Images and PDFs are drawn from the file. Text, HTML, mail and Office files are drawn from their
  extracted text, as a page, a slide or a grid, the same on every OS. A page is never rendered for
  its thumbnail. Old `.doc`, `.xls` and `.ppt` need `soffice`. Budgets are the defaults, not the
  config's.
- Video has no thumbnail here: the UI shows a frame through `<video>`, which needs no tool.
- Thumbnails are made on first view, in a worker. Keyed by content, a renamed file or a duplicate
  costs nothing, and a changed file simply gets a new key.
- `/thumb/:id` serves them with `Cache-Control: immutable` on a URL that holds the key.
- A file that cannot be thumbnailed gets an empty `<key>-<size>.fail` file, so a hostile file is not
  parsed again on every view. Clearing the cache retries it.
- Nothing cleans up old entries yet.

## Search

`content` is an FTS5 table with `tokenize='trigram'`. The default tokenizer found nothing on a Japanese
substring, and trigram did. It holds `FileState.text`, so only organized files have content search.

`FileQuery.text` searches content and file names.

| Query length | Content | Name |
| --- | --- | --- |
| 3 characters or more | `content MATCH '"<text>"'`, with `"` doubled | `file.path LIKE` |
| 1 or 2 characters | `content.text LIKE '%<text>%'`, a full scan | `file.path LIKE` |

**The minimum is 3 characters.** A shorter `MATCH` returns nothing, without an error (tested). That
matters: `東京` is two characters. So short queries fall back to `LIKE`, which is slower on a large
index. Escape `%` and `_` in `LIKE`.

Either way the matches are a `WITH c AS MATERIALIZED` query, read once and then joined to `file`.
Without that, SQLite runs `MATCH` again for every file row, which took over an hour at 100,000 hits.

## Tag filters

`FileQuery.tags` and `exclude_tags` match a tag and its children by prefix:

- `topic:finance` matches `topic:finance` and `topic:finance/tax`.
- `doc-date:2026` matches `doc-date:2026` and `doc-date:2026-03`.
- `topic:finance` does not match `topic:finance-law`. A `-` counts as a child boundary only after a
  four-digit year label.

Only the leaf is on disk, so this happens in the query. A range keeps it on the unique index on
`tag.name`, and needs no escaping. `0` and `.` are the characters right after `/` and `-`.

```sql
SELECT id FROM tag
WHERE name = :t
   OR (name >= :t || '/' AND name < :t || '0')
   OR (:is_year AND name >= :t || '-' AND name < :t || '.');
```

Matching is case-sensitive.

## Similarity

`similar_files` ranks files by IDF-weighted Jaccard over tags. Rare tags count for more, and facets
can be weighted.

```text
idf(t)   = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
w(t)     = idf(t) * weight(t)
W(X)     = sum of w(t) for t in X
sim(A,B) = S / (W(A) + W(B) - S),  where S = sum of w(t) for t in both A and B
```

`N` is the number of files in the index, and `df` is how many carry the tag. `weight` is the facet's
`weight`, or 1 for a plain tag. A weight of 0 leaves a facet out. Scores run from 0 to 1, and the
measure is symmetric.

**There is no ancestor expansion in v1.** `topic:finance` and `topic:finance/tax` are different tags
here, and share nothing. Prefix matching applies to filters only.

### Worked example

`N` = 100,000. The query file A has `doc-type:invoice`, `status:reference`, `project:acme`,
`year:2024` and `language:en`.

| Tag | df | idf | Facet weight | w |
| --- | --- | --- | --- | --- |
| `project:acme` | 120 | 6.72 | 2 | 13.44 |
| `project:zeta` | 80 | 7.12 | 2 | 14.25 |
| `doc-type:contract` | 2,500 | 3.69 | 1.5 | 5.53 |
| `doc-type:invoice` | 4,000 | 3.22 | 1.5 | 4.83 |
| `year:2023`, `year:2024` | 9,000 | 2.41 | 1 | 2.41 |
| `status:reference` | 30,000 | 1.20 | 0.5 | 0.60 |
| `language:en` | 70,000 | 0.36 | 0.25 | 0.09 |

W(A) = 4.83 + 0.60 + 13.44 + 2.41 + 0.09 = 21.37.

| File | Tags | Plain Jaccard | S | W | Score |
| --- | --- | --- | --- | --- | --- |
| B | `doc-type:contract`, `status:reference`, `project:acme`, `year:2023`, `language:en` | 0.429 | 14.13 | 22.07 | 14.13 / (21.37 + 22.07 - 14.13) = **0.482** |
| C | `doc-type:invoice`, `status:reference`, `project:zeta`, `year:2024`, `language:en` | 0.667 | 7.93 | 22.18 | **0.223** |
| D | `status:reference`, `language:en`, `year:2024` | 0.600 | 3.10 | 3.10 | **0.145** |

Plain Jaccard ranks B last. The weighted score ranks the contract from the same project first, which
is what a person means by "similar".

### SQL

Run after each scan, with `:n` as the file count:

```sql
UPDATE tag SET df = (SELECT count(*) FROM file_tag WHERE tag_id = tag.id);
UPDATE tag SET idf = ln(1 + (:n - df + 0.5) / (df + 0.5));
UPDATE file SET tag_w = coalesce((SELECT sum(t.idf * t.weight) FROM file_tag ft
  JOIN tag t ON t.id = ft.tag_id WHERE ft.file_id = file.id), 0);
```

The query:

```sql
WITH q AS (SELECT ft.tag_id, t.idf * t.weight AS w FROM file_tag ft
           JOIN tag t ON t.id = ft.tag_id
           WHERE ft.file_id = :id AND t.weight > 0),
     total AS (SELECT sum(w) AS s FROM q),
     hits AS (SELECT ft.file_id, sum(q.w) AS shared FROM q
              JOIN file_tag ft ON ft.tag_id = q.tag_id
              WHERE ft.file_id <> :id GROUP BY ft.file_id)
SELECT h.file_id, h.shared / (total.s + f.tag_w - h.shared) AS score
FROM hits h JOIN file f ON f.id = h.file_id, total
ORDER BY score DESC, h.file_id LIMIT :limit;
```

This SQL gave the scores above when run on `node:sqlite`. A file with no weighted tags returns no
rows. Applying a plan updates `tag_w` for the files it touched, using the current `idf`. Stale `idf`
between scans is harmless, since it drifts slowly.

## Verification

**Scan repairs drift.** The mirror can fall behind the disk when another app changes tags or `watch`
misses an event. A scan compares fingerprints and re-reads tags where they differ. The disk always
wins:

- A tag on disk and not in the mirror is added, with `ai = 0`.
- A tag in the mirror and not on disk is removed, with its `ai` flag.
- Lost tags raise `restore` items, as [described](tags.md#lost-tags).

A scan never writes to a file. Only an applied plan does.

**`doctor`** reports the state of the installation, and changes nothing. It checks the runtime, the
provider key, each library's volume, through `supported()`, and the optional tools `soffice` and
`ffmpeg`.

## Performance

**These are synthetic spike results, not benchmarks of Jevonganize.** They come from throwaway
scripts on one Apple M1 with warm caches, on a machine shared with other work. Treat them as rough.
Real tag distributions, cold disks and network volumes will differ.

| Operation | Data | Result |
| --- | --- | --- |
| Similarity query, exact | 100k files, 731k tag rows, 2,000 skewed tags | 24 to 45 ms at p50, 60 to 107 ms at p95 |
| `idf` refresh | Same | About 40 ms |
| `tag_w` rebuild | Same | 420 to 720 ms |
| Recursive `readdir` | 99,000 files | About 185 ms |
| `statSync` with bigint | 99,000 files | 264 to 598 ms |
| Read tags | 10,000 files, half tagged | 262 to 314 ms |
| sha256 | 1 GiB in memory, with SHA hardware | About 0.85 GB/s |

The exact similarity query is used. Skipping common tags made it faster, but lost 20 to 27 percent of
the top 50.

## Reusing local work

Extraction results are kept only in a bounded process-memory cache for 30 seconds, up to 32 MiB and
64 entries, with a fresh regular-file and fingerprint check on access. Pipeline, budget and image
settings are part of the key. Content hashes have a bounded fingerprint-keyed memory cache as well;
their `f1:`/`p1:` SHA-256 formats are unchanged. No new file-content cache is written to disk.
`file.extract_key` lets a repeat organize skip a file: see
[pipeline.md](pipeline.md#skipping-a-file-on-a-repeat-organize). It holds a hash, and no content.

Concurrent requests for the same thumbnail share one generation. Search totals are cached until
local SQLite changes or a different connection's data version changes. Page rows and tags are read
fresh, with only the requested page's tags hydrated. IDF and file weights are rebuilt only when
file counts, tag memberships or facet weights changed, tracked transactionally in schema version 3.
Similarity remains exact, including common tags, zero weights and deterministic ties.
