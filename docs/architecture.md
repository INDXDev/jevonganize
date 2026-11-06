# Architecture

Jevonganize organizes files you already have. It reads each file, asks a
[decision model](concepts.md#decision-models) typed questions about it, and writes the answers as
tags the operating system stores on the file. It never moves, renames, edits or deletes a file.

This document and [contracts.md](contracts.md) are the source of truth. If code and these documents
disagree, one of them has a bug. The reasoning behind each choice, with evidence, is in
[research/](research/).

## Principles

Human-facing translations live with their interface: `web/i18n/` for the browser/desktop UI and
`commands/i18n/` for terminal output. They use the same `language` config, without making the browser
import core runtime code or making engines depend on an interface. Catalog keys and named parameters
are checked by TypeScript; user data is only interpolated, never translated by matching its text.

1. **Tags on disk are the truth.** The database is an index of them. Delete it and tags survive.
2. **One operation, one definition.** Every operation is one entry in a tool table. The CLI, the
   HTTP API, the chat panel and the MCP server all call that entry.
3. **One server, three shells.** The CLI, the browser and the desktop app use the same server and
   the same UI. The desktop app adds a window and nothing else.
4. **Preview, then apply.** Every bulk change is a stored plan. A person sees it before it runs, and
   it can be undone.
5. **Closed output.** A model only picks from labels the schema defines, so a tag can never contain
   text a model made up. Open vocabularies pass through a person first.
6. **Files are hostile.** Names, contents and metadata are untrusted input. See
   [security.md](security.md).
7. **Prefer data to code.** Facets are TOML, the pipeline is a table, and the settings form is
   generated from the config schema.

## System overview

```text
  terminal            browser              desktop window        coding agent
     │                   │                  (Electron)               │
     │                   └───────┬──────────────┘                    │
     ▼                           ▼                                   ▼
  cli.ts ──────────▶ server/ on 127.0.0.1                          mcp.ts
     │                 guard → /api/call/:tool                       │
     │                         /api/events  /api/chat                │
     │                         /thumb/:id   /file/:id                │
     └───────────────────────────┬───────────────────────────────────┘
                                 ▼
                     core/tools.ts   the one tool table
                                 │
     ┌─────────────┬─────────────┼──────────────┬───────────────┐
     ▼             ▼             ▼              ▼               ▼
  scan.ts      organize.ts    plans.ts      similar (db)     facets.ts
     │             │             │                              │
     │        ┌────┴─────┐       │                              │
     │        ▼          ▼       │                              │
     │    extract/      ai/      │                          presets/*.toml
     │    (workers)  (providers) │
     ▼                           ▼
  core/db.ts  ◀───────────  core/tags.ts ──▶ xattr / NTFS stream on the file
  (SQLite index)            (the source of truth)
```

## The two flows

**Index.** Free, local and fast. No file content leaves the machine.

1. `scan` walks a library and compares each file's fingerprint with the index.
2. For a changed file it reads the tags from disk and updates the mirror.
3. `watch` keeps the index current between scans.

**Organize.** Reads content and calls a model, once per new file and facet.

1. **Select** files in scope, and the enabled facets that apply to each.
2. **Extract** text, images and metadata through the [pipeline](pipeline.md), in a worker.
3. **Derive** facets that need no model, from metadata.
4. **Decide** the remaining facets. Cached answers are reused, and everything missing goes in one
   call per file.
5. **Resolve** raw answers against thresholds. High confidence joins the plan, the middle band goes
   to the review queue, and the rest is dropped.
6. **Plan** the result. Nothing has been written yet.
7. **Apply** the plan: re-read each file's tags, merge, write, update the mirror.

Steps 1 to 6 run again for free when thresholds change, because raw answers are cached and
resolution runs after the cache.

## Repository layout

One package, no workspaces.

```text
jevonganize/
├── src/
│   ├── types.ts          Contracts shared by every layer. Imports nothing
│   ├── cli.ts            Entry point: command table, exit codes
│   ├── mcp.ts            Stdio MCP server over the tool table
│   ├── commands/         One file per command group: parse flags, print
│   ├── core/
│   │   ├── config.ts     Paths, zod schema, TOML load and save, UserError
│   │   ├── credentials.ts  API keys in a 0600 file
│   │   ├── sanitize.ts   Safe printing of untrusted text
│   │   ├── tags.ts       readTags, writeTags, supported: the OS boundary
│   │   ├── db.ts         openDb: the one handle to the index
│   │   ├── db/           All SQL, including similarity, one file per concern
│   │   ├── scan.ts       Walk, fingerprint, mirror tags
│   │   ├── exclusions.ts What is never read: secrets, app folders, `exclude`
│   │   ├── watch.ts      fs.watch to scan
│   │   ├── facets.ts     Load presets, map facets to questions
│   │   ├── facet-answers.ts Check, derive and resolve answers
│   │   ├── organize.ts   The organize flow
│   │   ├── content-hash.ts A file's content hash
│   │   ├── estimate.ts   What an organize run would cost
│   │   ├── plans.ts      Propose, apply, undo
│   │   ├── plan-conflicts.ts Whether an organize op still holds
│   │   ├── tools.ts      The tool table
│   │   └── tools/        Its rows by concern, jobs and watching
│   ├── extract/
│   │   ├── index.ts      Runs the pipeline for a file, in a worker pool
│   │   ├── extractors.ts Sniffing and the extractor table
│   │   ├── source.ts     What extractors share: signature, state writes, ranged reads
│   │   ├── pdf.ts        PDF text, metadata and page renders
│   │   ├── office.ts     Office documents, and soffice for legacy ones
│   │   ├── images.ts     Decoding, normalized images, EXIF, screenshots
│   │   ├── mail.ts       .eml and .msg
│   │   ├── media.ts      Audio and video tags, ffmpeg frames
│   │   ├── tools.ts      Optional programs: ffmpeg, soffice
│   │   ├── worker.ts     Worker entry
│   │   └── thumbs.ts     Thumbnail cache
│   ├── ai/               The only folder that imports `ai` or `@ai-sdk/*`
│   │   ├── providers.ts  Provider table
│   │   ├── openrouter.ts Decision adapter for OpenRouter
│   │   ├── decide.ts     decide(): cache, limits, refusals
│   │   ├── suggest.ts    Open tag suggestions
│   │   ├── chat.ts       Chat panel and `ask`
│   │   └── pricing.ts    Cost estimates
│   ├── server/
│   │   ├── app.ts        Hono routes
│   │   ├── guard.ts      Host, Origin, token checks
│   │   └── start.ts      Listen, open the browser
│   ├── desktop/main.ts   The Electron shell
│   └── web/              The React UI, see ui.md
├── presets/              10 packs of facets, as TOML
├── test/                 <module>.test.ts, plus test/fixtures/
├── docs/
├── examples/messy-downloads/   A deliberately messy folder for demos
└── .github/
```

## Layers

Dependencies point downward only. `.oxlintrc.json` enforces this, so a violation fails `pnpm lint`.

| Layer | Modules | May use |
| --- | --- | --- |
| Interface | `cli.ts`, `commands/`, `mcp.ts`, `server/`, `desktop/`, `web/` | The tool table, types, `config.ts`, `credentials.ts`, `ai/chat.ts`. `web/` uses types only |
| Tools | `core/tools.ts`, `core/tools/` | Everything below |
| Flows | `core/organize.ts`, `core/estimate.ts`, `core/plans.ts`, `core/plan-conflicts.ts`, `core/scan.ts`, `core/exclusions.ts`, `core/content-hash.ts`, `core/watch.ts` | Everything below |
| Engines | `extract/`, `ai/`, `core/facets.ts`, `core/facet-answers.ts` | Infrastructure, types |
| Infrastructure | `core/config.ts`, `core/credentials.ts`, `core/db.ts`, `core/db/`, `core/tags.ts`, `core/sanitize.ts` | Types |
| Contracts | `types.ts` | Nothing |

Rules that keep this honest:

- `web/` imports only types from outside itself, and talks to the server over HTTP.
- `core/tags.ts` is the only module that touches xattrs or NTFS streams.
- `core/db.ts` and `core/db/` are the only modules that contain SQL.
- `ai/` is the only folder that imports the AI SDK. Its decision API is experimental, so a breaking
  change must stay in one folder. Versions are pinned exactly.
- `extract/` is the only module that parses file contents, and it does so in workers.
- Only the interface layer prints. Everything else returns data or throws.
- Throw `UserError` for anything the user can fix. Any other error is a bug.

## Key decisions

| Decision | Choice | Why | Evidence |
| --- | --- | --- | --- |
| Tag store | xattr on macOS and Linux, NTFS stream on Windows | One uniform store per OS, with no per-file-type branching | [os-file-tags](research/os-file-tags.md) |
| Tag writes | Merge into a fresh read of the disk | A write can never lose a tag set elsewhere | [tags.md](tags.md) |
| Change detection | `fs.watch` plus periodic stat walk | chokidar and `@parcel/watcher` miss xattr changes on macOS | [os-file-tags](research/os-file-tags.md#8-detecting-external-changes) |
| Fingerprint | `ino`, `size`, `mtimeNs`, `ctimeNs` | A tag write moves ctime and not mtime on macOS | [os-file-tags](research/os-file-tags.md) |
| Index | `node:sqlite`, WAL | Nothing to install or rebuild, and FTS5 works | [extraction](research/extraction-storage-similarity.md#b1-sqlite-nodesqlite) |
| Model call | `experimental_decide` everywhere | Chat models join through a wrapper, so one call site | [decision-models](research/decision-models.md#6-design-recommendation) |
| Classification unit | One file, all facets, one call | Questions are cheap once the file is in context | [decision-models](research/decision-models.md) |
| Answer cache | Raw answers per facet, keyed on exactly what is sent | Thresholds and renames cost no model calls | [jevlint-reference](research/jevlint-reference.md) |
| Provenance | Applied AI tags recorded in the index | If the index is lost, all tags count as human, which only ever errs towards keeping them | [tags.md](tags.md) |
| Similarity | IDF-weighted Jaccard in SQL | Exact, and 24 to 45 ms at p50 on 100k synthetic files | [extraction](research/extraction-storage-similarity.md#c-similarity) |
| API shape | `POST /api/call/:tool` | The tool table is the API, so no route per operation | This document |
| Desktop | Electron, loading the local server | Same code as browser mode, with no preload and no IPC | [app-shell](research/app-shell-and-ui.md#1-native-wrapper-electron) |
| Config location | User config only, never per-folder | A zip unpacked in Downloads must not be able to plant settings | [jevlint-reference](research/jevlint-reference.md) |

## Data ownership

| Data | Location | Lost means |
| --- | --- | --- |
| Tags | On each file | Real loss. This is the user's data |
| Config, custom facets | Config directory, TOML | Real loss, but small and hand-editable |
| API keys | Config directory, `credentials.toml`, mode `0600` | Enter them again |
| Answers, reviews, plans, vocabulary | Data directory, `index.db` | Costs money to rebuild, and undo history is gone. Tags are safe |
| File mirror, search text | Same database | Rebuilt by the next scan and organize |
| Thumbnails | Cache directory | Rebuilt on demand |

Directories come from `env-paths`, so they follow each OS's convention.

## Concurrency

- The server process owns the database. `jevonganize mcp` and CLI commands open the same file; WAL
  and a busy timeout let them share it.
- Extraction runs in a `piscina` worker pool with up to four workers retained for 10 idle seconds.
  Thumbnail work takes priority over queued extraction, with bounded fairness. Successful results
  have a bounded 30-second memory cache, invalidated by file identity/times and extraction settings.
  PDF steps share one task-local document and page text; no document handles survive a task.
  Tag reads for batches of 32 or more changed scan files run in a separate worker. Small batches
  yield between reads without paying for worker startup.
  A parser that hangs is terminated on timeout, and a
  parser error fails one file rather than the job. A native crash ends the server, so a job can be
  run again; cached answers make that cheap.
- Model calls run under `p-limit`, at `concurrency` from config.
- Only one organize job runs at a time in a process. Two processes can overlap: answers are
  keyed by content, so the last write wins with the same meaning. That wastes money at worst and
  corrupts nothing.
- The UI refreshes on focus, so changes made by the CLI appear without a shared event bus.
- `node:sqlite` and `koffi` are synchronous. Long loops yield to the event loop between batches.
  In the desktop app the server runs in a `utilityProcess`, so the window can never freeze.

## Failure behaviour

| Failure | Behaviour |
| --- | --- |
| API key rejected | The job stops at once with a `UserError` |
| No key for the configured provider | The job refuses to start. It never falls back to another provider, because that sends content somewhere the user did not choose |
| Model refuses a question | Retry without those questions, and record them as refused |
| Rate limit | The SDK retries with backoff; the file is marked failed if that runs out |
| Other provider error, or extraction failure | That file is marked failed with a warning. The job continues |
| Tag write fails | The op is recorded as failed in the plan. The rest continue |
| Crash during apply | The plan shows as `applying`, then returns to `proposed` after two minutes. Applying it again finishes it, and undo covers both runs |
| Volume cannot store tags | `supported()` is false. The UI says so and offers no tag actions there |
| Tags vanished after a save | The scan sees a new inode with fewer tags, and adds a `restore` review item. See [tags.md](tags.md#lost-tags) |

## Non-goals

- Moving, renaming, deleting or de-duplicating files.
- Syncing tags between machines or operating systems. Each OS stores them separately.
- Cloud storage APIs. Synced folders work if the OS keeps the attributes.
- A hosted service, accounts or telemetry.
