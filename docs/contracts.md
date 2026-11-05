# Contracts

The interfaces between components. [`src/types.ts`](../src/types.ts) holds the shared data shapes;
this document holds everything else. Change a contract here first.

## The tool table

`core/tools.ts` defines every operation once:

```ts
interface Tool<I, O> {
  description: string;
  input: z.ZodType<I>;      // validated at every entry point
  run(input: I, ctx: Context): Promise<O>;
  writes: boolean;          // changes tags, config or stored state
  agent: boolean;           // offered to chat and MCP
  approval?: boolean;       // a person must approve it when a model calls it
}

interface Context {
  db: Db;
  config: Config;
  caller: 'cli' | 'ui' | 'chat' | 'mcp';   // sets Plan.source, and gates approval
  emit(event: ServerEvent): void;
}
```

`ToolMap` in `src/types.ts` is the typed form of this table. `web/` and `core/tools.ts` both build on
it, so neither imports the other.

| Tool | Input | Output | Writes | Agent |
| --- | --- | --- | --- | --- |
| `status` | none | libraries, counts, jobs, provider, key present | no | yes |
| `list_libraries` | none | `Library[]` | no | yes |
| `add_library` | `path` | `Library`, stored by real path. A secret folder is refused | yes | no |
| `remove_library` | `path` | `void` (index only; tags stay) | yes | no |
| `browse_dirs` | `path?` | child directories, for the folder picker | no | no |
| `scan` | `path?` | `Job` | yes | yes |
| `search_files` | `FileQuery`, 50 rows unless `limit` says otherwise | `{ files: FileRow[], total }` | no | yes |
| `get_file` | `id` or `path` | `FileDetail` | no | yes |
| `similar_files` | `id`, `limit?` | `SimilarFile[]` | no | yes |
| `list_tags` | `folder?`, `facet?` | `TagCount[]` | no | yes |
| `list_facets` | none | `FacetInfo[]` | no | yes |
| `save_facet` | `Facet` | `Facet` (custom only) | yes | no |
| `delete_facet` | `id` | `void` (custom only) | yes | no |
| `set_enabled` | `ids`, `enabled` | `void` (facets or packs) | yes | no |
| `estimate` | `query`, `facets?` | `Estimate` | no | yes |
| `organize` | `query`, `facets?` | `Job`, which yields a `Plan` | yes | yes, with approval |
| `cancel_job` | `id` | `void` | yes | no |
| `propose_changes` | `query` or `file_ids`, `add?`, `remove?`, `title` | `Plan` | stores a plan | yes |
| `rename_tag` | `from`, `to` | `Plan` | stores a plan | yes |
| `apply_plan` | `id` | `Job` | **yes** | yes, with approval |
| `undo_plan` | `id` | `Job` | **yes** | yes, with approval |
| `get_plan` | `id` | `Plan` | no | yes |
| `discard_plan` | `id` | `void` (proposed plans that wrote nothing) | yes | yes, with approval |
| `list_plans` | `status?` | `Plan[]` with `ops` empty. A crashed apply goes back to `proposed` here | no | yes |
| `list_reviews` | `tag?`, `limit?` | open `ReviewItem[]`, ordered by tag, then confidence | no | yes |
| `resolve_reviews` | `ids`, `accept` | `Plan` of the accepted items, or `null` | stores a plan | yes, with approval |
| `suggest_tags` | `id` | candidate tags, as review items | yes | yes, with approval |
| `set_vocabulary` | `facet`, `value`, `state` | `void` | yes | no |
| `cleanup_report` | none | near-duplicates, one-file tags, over-broad tags | no | yes |
| `get_config` | none | config and its JSON Schema | no | no |
| `set_config` | partial config | config | yes | no |
| `set_api_key` | `provider`, `key` | `void` | yes | no |
| `reveal_file` | `id` | `void`: shows it in the file manager | no | no |
| `doctor` | none | checks: runtime, key, volumes, optional tools | no | yes |

`agent: false` is a security boundary. A model must never reach keys or config, or add folders.
`apply_plan` takes only an id, so what a person saw is exactly what runs. Tools that start a job
return it at once. `Job.failed`, `Job.warnings` and `Job.scan` carry what a finished job found, so
front ends need no second call. `organize` and
`suggest_tags` need approval because they spend money and send content to a provider, and a
hostile file name could steer a model into calling them. `resolve_reviews` and `discard_plan` need
it because they drop what only a person should drop: a `restore` item is the one record of a lost
tag. The CLI and the UI are people, so they are not gated.

An organize op carries `TagOp.stamp`, the file's content when it was judged. `apply_plan` refuses that
op, in `plan.errors`, if the content changed, if a person rejected a tag, if a single-valued facet
gained another value since, if a tag it removes is no longer the app's, or if it would take the file
past `max_tags`. Other plans name their tags outright, so they merge. `undo_plan` refuses
an op whose added tags have all gone, rather than restore what it removed on top of a later decision.

`apply_plan` claims the plan first, with one `UPDATE ... WHERE status = 'proposed'` that moves it to
`applying`, so of two callers, in any two processes, one wins. Each op is recorded in `plan_op` as it
is written. A plan whose run shows no sign of life for two minutes counts as crashed: `list_plans` or
the next `apply_plan` returns it to `proposed`. Applying it again skips the recorded ops and merges
them into the final plan, so undo covers both runs. Until then it cannot be discarded.

`undo_plan` finishes as `undone` only when every op is reversed. Cancelled or partly failed, the plan
stays `applied` and holds only the unfinished ops, so `undo_plan` can run again. It restores tags with
`ai = 1` for an organize plan, and clears the tombstone of each tag it puts back.

Rejecting a `suggest` item keeps it as `rejected`, so a cached answer cannot bring it back. Accepting
or rejecting a `restore` item deletes it, so the next loss of that tag raises a new one. Accepting
only builds a plan: every tag write goes through `apply_plan`, so all of them can be undone.

## Tags: `core/tags.ts`

The only OS boundary. Identical on every OS. See [tags.md](tags.md).

```ts
readTags(path: string): Promise<Tag[]>                // normalized, sorted; [] when untagged
writeTags(path: string, tags: Tag[]): Promise<void>   // replaces the set; [] clears it
supported(path: string): Promise<boolean>             // can this volume store tags?
isScreenCapture(path: string): boolean                // macOS attribute; false elsewhere
normalize(tags: Tag[]): Tag[]
overwriteDropsTags: boolean                           // saving over a file loses its tags; true on Windows
```

## Extraction: `extract/`

```ts
type Extractor = (file: SourceFile, state: FileState, budget: Budget) => Promise<void>;
extractFile(path: string, config: Config): Promise<FileState & { mime: string }>
thumbnail(file: FileRow, size: 256 | 1024): Promise<string | null>   // path to a cached webp
```

Extractors run in pipeline order and only fill what is still empty. See [pipeline.md](pipeline.md).

## Decisions: `ai/`

```ts
resolveModel(config: Config, profile?: string): Promise<ResolvedModel>  // UserError with no key, unless `chat` or `compatible` has a base_url
decide(file: { state: FileState }, facets: Facet[], model: ResolvedModel, db: Db,
       onTokens?: (tokens: number) => void)   // each billed call, refused or later failed included
  : Promise<{ answers: Answer[]; tokens: number; cached: number; warnings: string[] }>
suggest(state: FileState, vocabulary: Tag[], model: ResolvedModel): Promise<Tag[]>
chat(messages: UIMessage[], ctx: Context): Response                     // streaming
estimateCost(tokens: number, model: ResolvedModel): number | null
```

## Facets: `core/facets.ts`

```ts
loadFacets(config: Config): Promise<Facet[]>            // presets plus custom; one bad file warns
withVocabulary(facets: Facet[], db: Db): Facet[]        // merges active values into open facets
facetHash(facet: Facet): string                         // covers only what the model sees
toQuestions(facet: Facet): Record<string, Question>     // SDK question objects, as plain data
fromAnswers(facet: Facet, raw: RawAnswers): Answer[]    // one per label for `multi`
derive(facet: Facet, state: FileState, config: Config): Tag | null   // `field` facets
resolve(answers: Answer[], facets: Facet[], config: Config, existing: Tag[], rejected: Tag[])
  : { apply: Tag[]; review: { tag: Tag; confidence: number | null }[] }  // pure
```

## Database: `core/db.ts`

All SQL is here, behind named functions. Tables:

```sql
CREATE TABLE library (path TEXT PRIMARY KEY, scanned_at INTEGER);

CREATE TABLE file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused, so an old plan cannot hit a new file
  path TEXT NOT NULL UNIQUE,
  dev TEXT, ino TEXT, size INTEGER, mtime_ns TEXT, ctime_ns TEXT,
  hash TEXT, state_hash TEXT, mime TEXT, metadata TEXT,
  status TEXT NOT NULL DEFAULT 'new', tag_w REAL NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX file_hash ON file(hash);
CREATE INDEX file_inode ON file(dev, ino);
CREATE INDEX file_name ON file(<last path segment> COLLATE NOCASE);   -- the default sort

CREATE TABLE tag (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, facet TEXT,
  weight REAL NOT NULL DEFAULT 1, df INTEGER NOT NULL DEFAULT 0, idf REAL NOT NULL DEFAULT 0
);
CREATE TABLE file_tag (                  -- mirror of what is on disk
  tag_id INTEGER NOT NULL, file_id INTEGER NOT NULL,
  ai INTEGER NOT NULL DEFAULT 0,         -- 1 when the app wrote it: a model answer or a `field`
  PRIMARY KEY (tag_id, file_id)
) WITHOUT ROWID;
CREATE INDEX file_tag_file ON file_tag(file_id, tag_id);

CREATE TABLE answer (                    -- raw model output: costs money to rebuild
  key TEXT PRIMARY KEY, facet TEXT NOT NULL,
  body TEXT NOT NULL,                    -- JSON Answer[], one per label for `multi`
  created_at INTEGER NOT NULL
);
CREATE TABLE file_answer (file_id INTEGER NOT NULL, facet TEXT NOT NULL, key TEXT NOT NULL,
  PRIMARY KEY (file_id, facet));

CREATE TABLE review (
  id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, kind TEXT NOT NULL, tag TEXT NOT NULL,
  confidence REAL, reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',    -- open, accepted, rejected
  UNIQUE (file_id, kind, tag)
);
CREATE TABLE plan (id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER);                   -- last sign of life of the run holding an `applying` plan
CREATE TABLE plan_op (plan_id TEXT NOT NULL, file_id INTEGER NOT NULL,
  body TEXT NOT NULL,                    -- JSON TagOp, written by a run that has not finished
  PRIMARY KEY (plan_id, file_id)) WITHOUT ROWID;
CREATE TABLE vocabulary (facet TEXT NOT NULL, value TEXT NOT NULL,
  state TEXT NOT NULL,                   -- proposed, active, retired
  PRIMARY KEY (facet, value));
CREATE VIRTUAL TABLE content USING fts5(text, tokenize='trigram');   -- rowid = file.id
```

`PRAGMA user_version` holds the schema version. Migrations are a list of SQL strings applied in
order. An index from a newer version is refused, never altered.

**Answer key:** `sha256(provider, configured model, endpoint, facetHash, state_hash)`, where
`state_hash` hashes what is sent, before the per-call delimiter marker is added. Changing the
pipeline or a budget changes the state, so stale answers cannot be reused, and an unchanged result
is not paid for twice. A moving alias such as `jev-latest` keeps its answers when the model behind
it changes, so pin a version when that matters.

**Removed tags stay removed.** When a person removes a tag with `ai = 1`, a `rejected` review row is
stored for it. `resolve` skips rejected tags, so the app never adds it back. This holds whether the
scan or a plan's write sees the removal first. Undoing the removal clears the row.

## HTTP

The server binds `127.0.0.1` on `port` from config, or the next free port. A stable port keeps the
browser's stored tabs and pane sizes, which belong to the origin. Every request passes
`server/guard.ts`: exact `Host`, `Origin` when present, `Sec-Fetch-Site`, then the token.

| Route | Purpose |
| --- | --- |
| `GET /auth?t=<token>` | Sets an `HttpOnly; SameSite=Strict` cookie, redirects to `/` |
| `POST /api/call/:tool` | JSON input, returns `{ ok: true, data }` or `{ ok: false, error }` |
| `GET /api/events` | Server-sent `ServerEvent`s |
| `POST /api/chat` | AI SDK UI message stream |
| `GET /thumb/:id?size=` | Cached webp, `Cache-Control: immutable` on a hash URL |
| `GET /file/:id` | Original bytes, with range support and `nosniff`. `CSP: sandbox` for active content |
| `GET /*` | The built UI |

Files are addressed by id, never by a path from the client. A `UserError` returns status 400 with
its message. Anything else returns 500 and is logged.

`web/` calls tools through one function typed from the table:

```ts
call<K extends ToolName>(tool: K, input: ToolInput<K>): Promise<ToolOutput<K>>
```

## CLI

See [cli.md](cli.md). The contract, shared with Jevlint:

- stdout carries results only. Warnings, progress and prompts go to stderr.
- `--json` on every command, with the tool's output unchanged. NDJSON for streams.
- Exit codes: `0` success, `1` a check failed, `2` usage, config or provider error.
- Commands run tools in-process. They need no running server.

## MCP

`jevonganize mcp` serves tools with `agent: true` over stdio only. Tool names and schemas are the
table's. Tools marked `approval` return a `needs_approval` result, shaped as in
[llm-native.md](llm-native.md), and do nothing, unless the server was started with `--allow-apply`.
A plan stays `proposed`, and the Review view lists proposed plans beside review items.

## Config

See [configuration.md](configuration.md). One zod schema in `core/config.ts` validates the TOML
file, the `set_config` tool and the settings form, which is generated from its JSON Schema.
Keys stay `snake_case` as written, with no mapping layer. The whole file, with its defaults:

```toml
port = 48620                     # the next free port is used if this one is taken
concurrency = 8
max_tags = 10                    # hard cap per file on what organize adds, counting a person's tags
fiscal_year_start = 4            # month, for `fiscal-year` fields
exclude = ["node_modules", ".git", "*.tmp", ".DS_Store", "._*", "Thumbs.db"]   # added to the built-in secret exclusions
send_images = true               # false keeps every image on this machine

[provider]                       # the default model
name = "openai"
model = "gpt-6-luna"
# base_url, account_id: for providers that need them

# [profiles.vision]              # optional extra models, named by a facet's `profile`
# name = "typesafe"
# model = "jev-latest"

[chat]                           # chat panel and tag suggestions
name = "openai"
model = "gpt-6-luna"

[facets]
enabled = ["core", "time", "sensitivity", "media"]   # packs, or single facet ids
disabled = []

[thresholds]
apply = 0.85                     # at or above: joins the plan
review = 0.50                    # at or above: review queue. Below: dropped
estimated_to_review = true       # answers without native probabilities never auto-apply

[budget]
text_chars = 8000                # 6000 from the start, 2000 from the end
pdf_pages = 10
render_pages = 2                 # pages rendered when a PDF has little text
thin_text_chars = 200            # per page, below which a PDF counts as scanned
images = 2
image_edge = 768
sheets = 5
sheet_rows = 50
zip_entries = 200
max_parse_mb = 200               # PDF and everything else
max_office_mb = 25               # Office files inflate far beyond their size in memory
timeout_seconds = 30

[[pipeline]]                     # first match wins; order within `use` is run order
match = "application/pdf"
use = ["pdf", "pdf-render"]
# ...the defaults are listed in pipeline.md

[watch]
enabled = true
walk_minutes = 30                # full stat walk, which catches missed events
```

## Facet files

Presets and custom facets share one format. `presets/<pack>.toml` ships with the app;
`<config dir>/facets/*.toml` holds the user's. A custom facet with a preset's id replaces it.

```toml
pack = "finance"
title = "Finance"

[[facet]]
id = "invoice-state"
title = "Invoice state"
kind = "choice"
instructions = "What is the payment state of this invoice?"
applies_to = ["application/*", "image/*"]
weight = 1.0

[facet.values]
paid = "It shows the invoice was paid: a receipt, or a paid stamp."
unpaid = "It asks for payment that is still due."
```

Tags are `<id>:<label>`, or `flag:<id>` for a `flag`. Every `choice` also offers an implicit
`other`, which writes nothing. So does a `level` step named `none`.

## Desktop

`desktop/main.ts` forks `server/start.ts` in a `utilityProcess`. `start.ts` detects
`process.parentPort`, skips opening a browser, and posts `{ port, token }`. The shell then
loads `http://127.0.0.1:<port>/auth?t=<token>` in a sandboxed window. There is no preload and no
IPC, so the renderer is identical to a browser tab.
