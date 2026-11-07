# Contracts

The interfaces between components. [`src/types.ts`](../src/types.ts) holds the shared data shapes,
and [`src/tool-map.ts`](../src/tool-map.ts) each tool's input and output;
this document holds everything else. Change a contract here first.

## The tool table

`core/tools.ts` assembles the table from the rows in `core/tools/`. Every operation is defined once:

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

`ToolMap` in `src/tool-map.ts` is the typed form of this table. `web/` and `core/tools.ts` both build on
it, so neither imports the other.

| Tool | Input | Output | Writes | Agent |
| --- | --- | --- | --- | --- |
| `status` | none | libraries, counts, jobs, provider, key present | no | yes |
| `list_libraries` | none | `Library[]` | no | yes |
| `add_library` | `path` | `Library`, stored by real path. A secret folder is refused | yes | no |
| `remove_library` | `path` | `void` (index only; tags stay) | yes | no |
| `browse_dirs` | `path?` | `DirListing`: a folder's entries and the usual places, for the folder picker | no | no |
| `scan` | `path?` | `Job` | yes | yes |
| `search_files` | `FileQuery`, 50 rows unless `limit` says otherwise | `{ files: FileRow[], total }` | no | yes |
| `get_file` | `id` or `path` | `FileDetail` | no | yes |
| `similar_files` | `id`, `limit?` | `SimilarFile[]` | no | yes |
| `list_tags` | `folder?`, `facet?` | `TagCount[]` | no | yes |
| `list_tag_tree` | `facet?`, `folder?` | `TagNode[]`: the tags as a tree by facet and `/`, with implicit parents | no | yes |
| `list_folders` | `folder` | `FolderCount[]`: the folders directly under it, by name, with the indexed files below each | no | yes |
| `list_facets` | none | `FacetInfo[]` | no | yes |
| `save_facet` | `Facet` | `Facet` (custom only) | yes | no |
| `delete_facet` | `id` | `void` (custom only) | yes | no |
| `set_enabled` | `ids`, `enabled` | `void` (facets or packs) | yes | no |
| `estimate` | `query`, `facets?` | `Estimate` | no | yes |
| `organize` | `query`, `facets?` | `Job`, which yields a `Plan` | yes | yes, with approval |
| `cancel_job` | `id` | `void` | yes | no |
| `propose_changes` | `query` or `file_ids`, `add?`, `remove?`, `title` | `Plan` | stores a plan | yes |
| `rename_tag` | `from`, `to`, `children?` (false) | `Plan`. With `children`, every tag under `from` follows, and `Plan.renames` records it | stores a plan | yes |
| `move_tag` | `from`, `parent`: a tag, or null for the top | `Plan` renaming `from` and every tag under it to sit under `parent`. See [tags.md](tags.md#hierarchy) | stores a plan | yes |
| `apply_plan` | `id` | `Job` | **yes** | yes, with approval |
| `undo_plan` | `id` | `Job` | **yes** | yes, with approval |
| `get_plan` | `id` | `Plan` | no | yes |
| `discard_plan` | `id` | `void` (proposed plans that wrote nothing) | yes | yes, with approval |
| `list_plans` | `status?` | `Plan[]` with `ops` empty. A crashed apply goes back to `proposed` here | no | yes |
| `list_reviews` | `tag?`, `limit?` | open `ReviewItem[]`, ordered by tag, then confidence | no | yes |
| `resolve_reviews` | `ids`, `accept` | `Plan` of the accepted items, or `null` | stores a plan | yes, with approval |
| `suggest_tags` | `id` | candidate tags, as review items | yes | yes, with approval |
| `refresh_candidates` | `tag`, `limit?` (50, at most 200) | `RefreshCandidates`: files that lack the tag but look like its files, best first, with their signals and an estimate. Calls no model | no | yes |
| `refresh_tag` | `tag`, `limit?`, `file_ids?` | `Job`: asks the decision model about each candidate, and adds the yeses as review items. Writes no tag | yes | yes, with approval |
| `search_catalog` | `text`, `limit?` | catalog values containing the text | no | yes |
| `pick_topics` | `query`, `limit?` (100) | `TopicPicks`: the likeliest catalog values for the file names. Changes nothing | no | yes, with approval |
| `list_vocabulary` | `facet?` | `VocabularyEntry[]`: values of open facets | no | yes |
| `set_vocabulary` | `facet`, `value`, `state` | `void` | yes | no |
| `cleanup_report` | none | near-duplicates, one-file tags, over-broad tags, and `redundant_parents` | no | yes |
| `get_config` | none | config, its JSON Schema, and the config, data and cache paths | no | no |
| `set_config` | partial config | config | yes | no |
| `list_keys` | none | `KeyList`: each provider's key source and whether its variable is set, never a key | no | no |
| `set_api_key` | `provider`, `key` | `void` | yes | no |
| `remove_api_key` | `provider` | `{ removed }` | yes | no |
| `set_env_keys` | `allowed` | `void`: allows or refuses keys from the environment | yes | no |
| `reveal_file` | `id` | `void`: shows it in the file manager | no | no |
| `open_file` | `id` | `void`: opens it in its default app. Refuses executables, see [security.md](security.md#opening-a-file) | no | no |
| `doctor` | none | checks: runtime, key, volumes, optional tools | no | yes |
| `list_vfolders` | `generated?` | `VirtualFolderTree`: saved folders as a tree with counts, plus the generated tree when asked | no | yes |
| `save_vfolder` | `id?`, `name`, `parent?`, `rule`, `tag?` | `VirtualFolder`. Stored state only, never a tag | yes | no |
| `delete_vfolder` | `id` | `void`: the folder and those under it. Files and tags stay | yes | no |
| `vfolder_files` | `id` or `generated`, paging and sort | `{ files: FileRow[], total, query }` through `search_files`, 50 rows unless `limit` says otherwise | no | yes |
| `add_to_vfolder` | `id`, `file_ids` | `Plan` adding the folder's home tag, and its ancestors' | stores a plan | yes |
| `remove_from_vfolder` | `id`, `file_ids` | `Plan` removing the folder's home tag | stores a plan | yes |
| `list_favorite_tags` | none | `FavoriteTag[]`: starred tags in order, each with the files carrying it now, 0 included | no | yes |
| `set_favorite_tag` | `tag`, `favorite`, `position?` | `void`. Stored state only, never a tag | yes | no |
| `usage_report` | `since?`, `until?` (ms), `bucket?` (`day`, `week` or `month`; `day`) | `UsageReport`: recorded model calls in total and by bucket, feature, bucket and feature, and model | no | yes |
| `library_report` | none | `LibraryReport`: files per library by state, kinds, top 10 tags, open reviews, plans, answer cache | no | yes |
| `suggest_vfolder_tags` | the rule being built: `tags`, `tag_match`, `exclude_tags?`, `folder?`, `text?`, `limit?` (12, at most 50) | `VfolderTagSuggestions`: `matches`, the rule's `search_files` total, and tags to add, each with its count, its count within the rule and why. Statistics only, calls no model | no | yes |
| `suggest_vfolders` | `limit?` (8, at most 30) | `VfolderSuggestion[]`: folders worth saving, each a name, a `FolderRule`, its count and why. Statistics only, calls no model | no | yes |

`FileQuery.hide_dotfiles` leaves out names starting with a dot and anything in such a folder, counted
from the library, so a library inside a dot folder still shows. `direct_only` keeps to what sits
directly in `folder`. Both default to off: only the UI sets them, from `[view]`.

`FileQuery.tag_match` says whether a file needs `any` of `tags` or `all` of them. The default is
`all`, so a query only ever gets narrower unless it asks otherwise: a script or agent that repeats a
tag keeps its meaning, and a plan built from a query cannot silently grow. The UI always says which it
wants, and starts on `any`. `exclude_tags` is not affected: a file with any of them is out.

`FileQuery.tag_groups` holds more tag conditions, each with its own `tag_match`, and a file must pass
every one of them as well as `tags`. A tag in any of these lists that ends in `:`, such as `topic:`,
stands for every tag in that namespace.

A [virtual folder](concepts.md#virtual-folders) is a `FolderRule`: `tags`, `tag_match`,
`exclude_tags` and an optional `folder`, which must be a library or a folder in one. It is a subset of
`FileQuery`, so its files come from the `search_files` SQL and nothing else. A child narrows its
parent: `vfolder_files` turns the folder and each ancestor into one `tag_groups` entry each, joins
their `exclude_tags`, and uses the deepest `folder`. `save_vfolder` validates the rule with zod, and
each read checks it again; a damaged row is left out of `list_vfolders`, with the folders under it,
and can still be deleted. It refuses a cycle, a tree deeper than 8, a name already used beside it, a
scope outside a library, and a scope that leaves an ancestor's or strands a child's. Left out,
`tag_match` is `all`, the lists are empty, and `tag`, the home tag, is the rule's tag when it has
exactly one that is not a whole namespace. Otherwise it is null, and nothing can be put in the folder.
A generated folder is never stored: one per namespace, a child per value, nested by `/`, and a month
under its year. Its key is the tag, or `<namespace>:`. Counts come from the search total cache, and a
generated leaf uses its tag count, so listing stays fast on a large index.

`add_to_vfolder` plans the home tag of the folder and of each ancestor that has one, so the file shows
in the folder it was put in. `remove_from_vfolder` plans removing only the folder's own home tag; a
file the rule still matches through another tag stays in it. Both are plans, so a person applies them
with `apply_plan` and can undo them. Folder names and rules are a person's text, and are sanitized
where they are printed like any other.

A favorite tag is kept by name, not by tag id, so it stays listed while no file carries it. Its count
is the files carrying exactly that tag, as in `list_tags`. `set_favorite_tag` with `favorite: true`
puts a new tag at `position`, clamped to the list, or at the end, and moves one already starred when a
position is given; `favorite: false` removes it. Positions always run from 0 with no gap. Dropping a
file on a favorite tags it through `propose_changes` and `apply_plan`, like any other tag write.

**Usage.** Every model call is recorded as one `usage` row by the flow or tool that made it: `ai/`
returns what a call billed, input and output tokens, and stores nothing. `organize` records one row per
file and model (`files = 1`), and one `names` row per file whose proper names were read. `refresh_tag`
records one row per file checked, `suggest_tags` one per chat call and one per verifier call,
`pick_topics` one per request, and chat and `ask` one per turn. Rows of a job carry its id, and
`Job.tokens` and `Job.cost_usd` are the sums of those rows: tokens both ways, and cost `null` once any
call has no known price. When an organize run ends, cancelled or not, one `organize-cache` row with no
tokens counts its files that cost no model call: every answer cached, shared with an identical file, or
reused from the last result. `library_report`'s `hit_rate_30d` is those files over those plus the files
of `organize` rows, over the last 30 days. With several profiles a file asked by two models counts
twice, so the rate is a lower bound. `estimateCost` adds input and output prices; `Estimate` stays
input only, as output is unknown before a run.

`usage_report` covers `since` up to, not including, `until`. Left out, the range is every row kept.
Buckets are local calendar days, weeks starting on Monday, and months. `cost_usd` adds the known
prices, and `unknown_cost_calls` counts the calls left out of it. An `organize-cache` row is no call:
it adds to `files` and not to `calls`. Rows older than 365 days are deleted when an index is opened.
Nothing in `usage` leaves the machine.

**Suggesting folders.** `suggest_vfolder_tags` and `suggest_vfolders` read only the index's tag
statistics. They call no model, so nothing leaves the machine and nothing costs money. Their order is
deterministic: ties go to the tag in code point order.

`suggest_vfolder_tags` collects candidates in this order, keeps the first reason a tag gets, and stops
at `limit`:

1. `narrows`: when the rule has tags, the tags of the files it matches that at least 2 of them carry
   but not all, so adding one narrows the folder. Best first by `with_rule × idf`, with `tag.idf`.
2. `favorite`: favorite tags not in the rule yet, in their order.
3. `recent`: tags the 20 newest applied plans added, newest plan first, that some file still carries.
4. `common`: only when the rule has no tags, the tags most files of its scope carry.

`matches` is the rule's total, from the same total cache as `search_files`. `count` is every file
with the tag, and `with_rule` the files the rule matches that carry it. A tag already in the rule, an
excluded tag and a retired vocabulary value are never offered.

`suggest_vfolders` offers three kinds, interleaved in this order until `limit`: `large-tag`, a tag on
at least 2 files, `topic:`, `party:`, `project:` and `entity:` first, then by count; `pair`, two of the
50 most used tags that at least 2 files carry together more often than chance (lift above 1), most
shared first, as an `all` rule; and `namespace`, the parent of hierarchical values, such as
`topic:finance` over `topic:finance/tax`, when it holds at least 2 tags. A rule equal to a saved
folder's own rule is left out, and so is a retired value. The name is the value made readable:
`topic:finance/tax` becomes `finance / tax`, and a pair is `<A> × <B>`.

**The tag tree.** `list_tag_tree` derives the tree from tag names; no table stores a parent. See
[tags.md](tags.md#hierarchy). A `TagNode` is `{ path, facet, label, depth, direct, total, implicit,
movable, children }`. The top level holds one root per facet in use, whose `path` is `<facet>:`, with
`depth` 0, then each `flag:` tag as a leaf, then the roots of plain tags, which have `depth` 1 like a
facet's first level. `label` is the last `/` part, or the facet id on a root. `direct` counts the files
carrying `path` itself, and `total` those carrying it or a name under it by `/`, each file once,
which is what filtering by the node finds for any tag but a year with months. `implicit` is `direct = 0`. `movable` is true for labels of
an open facet and for plain tags. Children are sorted by `path`, so the order is stable. `folder`
counts only files under it, and drops nodes left with none. `facet` keeps that facet's root.

`move_tag` refuses, with a `UserError`, a `from` that no file carries with nothing under it, a closed
facet's label or a `flag:` tag, a `parent` in another facet or plain where `from` is not, a `parent`
that is `from` or under it, a move that changes nothing, and any tag that would end deeper than 6
levels. `rename_tag` with `children` refuses a `to` under `from`, and the same depth. Both build one op
per file, renaming every tag under `from` on it, and store `Plan.renames`, `[{ from, to }]`, meaning
the prefix `from` becomes `to` on every name equal to it or under it. A new name already carried by
files merges into it, and `Plan.merges` lists `{ from, into, files }` for each, `files` being the files
carrying `from`, so the plan can say "N files merge into existing `into`". `rename_tag` without
`children` stores neither, and behaves as it always has.

`cleanup_report.redundant_parents` lists `{ tag, parent, files }`: `files` carry both `tag` and
`parent`, an ancestor of it, which search already finds through `tag`. Ordered by `files`, most
first, then by name. To drop the parents, propose `propose_changes` with
`query: { tags: [tag] }` and `remove: [parent]`: only files that carry `parent` itself get an op.

Every tool has a place in the UI, which `test/tools.test.ts` checks, or is listed as waiting for its
screen. See [ui.md](ui.md#cli-and-ui-parity).

`agent: false` is a security boundary. A model must never reach keys or config, or add folders.
`apply_plan` takes only an id, so what a person saw is exactly what runs. Tools that start a job
return it at once. `Job.failed`, `Job.warnings` and `Job.scan` carry what a finished job found, so
front ends need no second call. `organize`, `suggest_tags`, `refresh_tag` and `pick_topics` need
approval because they spend money and send file data or file names to a provider, and a
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

**Renames follow through.** When a plan with `renames` finishes applying as `applied`, in the same
transaction that stores it and after its ops, each rename follower listed in `core/tag-followers.ts` rewrites
the stored state that names a renamed path, and the plan keeps what each changed in `Plan.followed`:
the vocabulary of an open facet retires the old path and turns the new one active, and virtual folders
get their rule's `tags`, `exclude_tags` and home tag renamed, and favorite tags take the new name in
the same place. A namespace such as `topic:` is left
alone. `undo_plan` puts back what `followed` holds once the plan is `undone`, in the transaction that
stores it, so a partly undone plan keeps the new names until its last op is reversed. `[tag_colors]`
is not rewritten.

**Refreshing a tag.** `refresh_candidates` and `refresh_tag` spread a tag `T` to files that lack it
but look like the files that have it. See [tags.md](tags.md#refreshing-a-tag).

- Seeds are the files with `T` or a child of it, up to 200, most recently modified first.
- Candidates are files without `T` or a child, with no `suggest` review row for `T` in any state, and,
  when `T` is a label of a `choice`, `level`, `date` or `field` facet, with no other value of that
  facet. Paths that may not be read, as for `organize`, are left out.
- Three local signals rank them, each from 0 to 1: the share of the seeds' characteristic words a
  file's searchable text holds (40%), the share of the weight of tags that go with `T` a file has
  (30%), and its highest `similar_files` score to one of the first 10 seeds (20%). A word of `T`'s
  value in the file name adds 10%. Ties break by file id, so the order is stable.
- A candidate whose stored `state_hash` already has a valid answer to the refresh question is left
  out and counted in `checked`. A file that was never organized has no stored state, so it stays a
  candidate, and its answer comes from the cache for free once read.
- `refresh_tag` refuses with no key before reading anything, like `organize`. With `file_ids` it
  checks only those of the top 200 candidates. It asks the decision model of `T`'s facet profile, or
  the default `[provider]`, never `[chat]` or `[ner]`. The question is one `flag`: whether the file
  should carry `T`, with the facet's own instructions and the label's definition when `T` is a facet
  label. Its answer is cached under the usual answer key, with `facetHash` of that question, so a
  changed facet definition asks again. The model returns only a probability.
- A yes at or above `thresholds.review` becomes a `suggest` review item for `T`, with a reason naming
  the signals. The items are stored when the job ends, so a cancelled run leaves none. `Job.reviews`
  counts them, and `Job.tag` is `T`.

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
A task owns its PDF handles and page text until all steps finish, and closes them even on failure.
`SourceFile.images` tells image-producing steps whether pixels are needed; metadata is still read.
The shared extraction pool retains idle workers for 10 seconds, with at most four workers. Queued
thumbnail work has priority, with a background task after three foreground tasks to prevent starvation.
Timeouts and external-tool deadlines start when a task leaves the queue.

Successful extraction results may be reused in process for 30 seconds, up to 32 MiB and 64 entries.
The key includes the absolute path, device/inode, size, nanosecond mtime/ctime, pipeline, budgets and
image setting. A fresh regular-file check precedes every lookup, results are copied for each caller,
and files that change during extraction or produce warnings are not cached. Nothing extra is persisted.
Workers load neither `zod` nor `koffi`: defaults arrive with the task, and `extractFile` reads the
macOS screen-capture attribute itself and passes it in. A server keeps idle workers for 60 seconds.
Concurrent thumbnail requests for one output share one generation; different sizes remain independent.

## Decisions: `ai/`

```ts
resolveModel(config: Config, profile?: string): Promise<ResolvedModel>  // UserError with no key, unless `chat` or `compatible` has a base_url
decide(file: { state: FileState; onTokens?: (tokens: TokenUsage) => void },  // each billed call, refused or later failed included
       facets: Facet[], model: ResolvedModel, db: Db)
  : Promise<{ answers: Answer[]; tokens: TokenUsage; cached: number; warnings: string[]; state_hash: string }>
suggest(state: FileState, vocabulary: Tag[], model: ResolvedModel,
        options?: { onUsage?: OnUsage }): Promise<Tag[]>                // onUsage hears each billed call
chat(messages: UIMessage[], ctx: Context, tools, onUsage?: OnUsage): Response   // streaming; onUsage at the end
estimateCost(tokens: TokenUsage, model: ResolvedModel): number | null  // input plus output; null if a price is unknown
```

`TokenUsage` is `{ input, output }`. `ai/` never touches the index: the caller of each function above
turns what `onTokens` or `onUsage` hears into a `usage` row.

## Facets: `core/facets.ts`, `core/facet-schema.ts`, `core/facet-questions.ts`, `core/facet-answers.ts`, `core/answer-tags.ts`

```ts
loadFacets(config: Config): Promise<Facet[]>            // presets plus custom; one bad file warns
withVocabulary(facets: Facet[], db: Db): Facet[]        // merges active values into open facets
facetHash(facet: Facet): string                         // covers only what the model sees
toQuestions(facet: Facet): Record<string, Question>     // SDK question objects, as plain data
fromAnswers(facet: Facet, raw: RawAnswers): Answer[]    // one per label for `multi`
derive(facet: Facet, state: FileState, config: Config): Tag | null   // `field` facets
resolve(answers: Answer[], facets: Facet[], config: Config,
        tags: { existing: Tag[]; rejected: Tag[]; derived?: Tag[] })
  : { apply: Tag[]; review: { tag: Tag; confidence: number | null }[] }  // pure
```

## Database: `core/db.ts`

All SQL is here and in `core/db/`, behind named functions. Tables:

```sql
CREATE TABLE library (path TEXT PRIMARY KEY, scanned_at INTEGER);

CREATE TABLE file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused, so an old plan cannot hit a new file
  path TEXT NOT NULL UNIQUE,
  dev TEXT, ino TEXT, size INTEGER, mtime_ns TEXT, ctime_ns TEXT,
  hash TEXT, state_hash TEXT, mime TEXT, metadata TEXT,
  status TEXT NOT NULL DEFAULT 'new', tag_w REAL NOT NULL DEFAULT 0, error TEXT,
  extract_key TEXT                       -- names the extraction `state_hash` came from
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
CREATE TABLE vfolder (                   -- virtual folders: rules, never files
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  parent INTEGER REFERENCES vfolder(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,                    -- JSON FolderRule, checked on write and on read
  tag TEXT,                              -- the home tag, or null
  created_at INTEGER NOT NULL,
  UNIQUE (parent, name)
);
CREATE UNIQUE INDEX vfolder_root_name ON vfolder(name) WHERE parent IS NULL;
CREATE TABLE favorite_tag (tag TEXT PRIMARY KEY,   -- by name, so it outlives a tag with no file
  position INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE usage (                     -- one row per model call; never leaves the machine
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,                   -- ms since the epoch
  feature TEXT NOT NULL,                 -- organize, organize-cache, names, suggest, topics, refresh, chat
  provider TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cost_usd REAL,                         -- null when the price is unknown
  job_id TEXT,                           -- the job that made the call, if any
  files INTEGER NOT NULL DEFAULT 0       -- files the call worked on; 0 for chat
);
CREATE INDEX usage_at ON usage(at);
```

The internal scan tag reader checks regular files again, reports each failure separately, and never
writes tags. Batches of 32 or more paths run in a separate worker; smaller batches avoid worker
startup and yield between regular-file checks. Discovery, exclusions, move detection and mirror transactions stay in the scan flow.

Schema version 3 also keeps one `similarity_state` row with a `dirty` flag. Triggers mark it dirty
when files or tag memberships are inserted/deleted or similarity weights change. An IDF refresh
rebuilds weights and clears the flag atomically; an unchanged scan does not rebuild them. The flag
is shared across connections and rolls back with its transaction.

Search totals may be cached per connection, bounded to 128 query shapes. Local total changes and
SQLite's data version invalidate them, including writes from another process. Paging and sorting
reuse the same total, while result rows are always selected afresh. Indexed name scans keep their index traversal. Other bounded sorts select page ids before loading
tag arrays. Similarity still ranks every candidate with the exact weighted formula.

`PRAGMA user_version` holds the schema version. Migrations are a list of SQL strings applied in
order. An index from a newer version is refused, never altered. Schema version 5 adds `vfolder`, and
version 6 adds `favorite_tag` and `usage`.
`delete_vfolder` deletes the subtree itself, as the connection does not turn on `foreign_keys`.

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
| `GET /assets/*` | The UI's hashed files, `Cache-Control: immutable` |
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
A plan stays `proposed`, and the Review section of Tags lists proposed plans beside review items.

## Config

`language` is an application-wide setting: `system` (default), `en`, `ja`, or `zh-CN` (Simplified Chinese).
It controls human-facing interface text and formatting in the CLI and the shared browser/desktop UI;
it does not follow browser headers, URLs, or per-folder files. `system` uses the server machine's
preferred UI language: macOS global AppleLanguages, Windows user UI language, or the Linux session
locale (`LC_ALL`, `LC_MESSAGES`, then `LANG`; `LANGUAGE` takes precedence for messages outside a
`C`/`POSIX` session). Japanese and Chinese variants map to `ja` and `zh-CN`; other languages fall back
to English. The detected language is fixed for the process lifetime.
`get_config` also returns `system_language`, the resolved language, outside the persisted config.
A saved change updates the UI without restarting; the CLI reads it on each invocation.
Command names, config keys, tool schemas, JSON and
MCP results, stored tags, facet questions and model/cache semantics stay independent of this setting.
Translations are explicit catalogs with named interpolation; filenames, provider errors and user
content are never looked up as translation keys. Native/parser/provider diagnostics may retain their
original language, as can shared engine/tool and third-party diagnostics. English remains the startup
fallback before valid config can be read.

See [configuration.md](configuration.md). One zod schema in `core/config.ts` validates the TOML
file, the `set_config` tool and the settings form, which is generated from its JSON Schema.
Keys stay `snake_case` as written, with no mapping layer. The whole file, with its defaults:

```toml
language = "system"              # system, en, ja, zh-CN; presentation only
port = 48620                     # the next free port is used if this one is taken
concurrency = 8
max_tags = 10                    # hard cap per file on what organize adds, counting a person's tags
fiscal_year_start = 4            # month, for `fiscal-year` fields
exclude = ["node_modules", ".git", "*.tmp", ".DS_Store", "._*", "Thumbs.db"]   # added to the built-in secret exclusions
send_images = true               # false keeps every image on this machine

[tag_colors]                     # empty: every facet gets an automatic colour
# "doc-type" = "blue"            # a whole facet
# "doc-type:invoice" = "red"     # one tag, which beats its facet

[view]                           # how the file list looks. See configuration.md
show_dotfiles = false
include_subfolders = true
show_extensions = true
thumbnail_size = 160
grid_columns = 0
grid_spacing = 10
thumbnail_fit = "cover"
grid_info = "tags"
text_size = 12
list_columns = ["tags", "size", "modified"]
list_thumbnails = false

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

[ner]                            # reads proper names out of files
name = "openai"
model = "gpt-5.4-mini"

[facets]
enabled = ["core", "time", "sensitivity", "media"]   # packs, or single facet ids
disabled = []

[thresholds]
apply = 0.5                      # at or above: joins the plan
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
