# CLI reference

Human-facing help, prompts and results follow the global `language` setting (`system` by default).
Set `language` to `en`, `ja` or `zh-CN` to override the PC language, or back to `system` to follow it.
Commands, flags, config keys, JSON and MCP data keep their stable names. Shared engine/tool and
third-party diagnostics may retain their original language. See [Interface language](configuration.md#interface-language).

Every command runs tools in-process, so none needs a running server. Each maps to entries in the
[tool table](contracts.md#the-tool-table), and the tables below say which.

Every command supports `--help` and `--json`, and `jevonganize --version` prints the version. An
unknown flag is an error, and every error ends with `Run: <command> --help`.

Jevonganize needs Node.js 24.22.1 or later. It refuses older versions, because it parses hostile
files.

## Output

- stdout carries results only. Warnings, progress and prompts go to stderr.
- `--json` prints the tool's output unchanged. Commands that run a job print NDJSON: one `Job` per
  line, and the last line is the final state.
- Text output is [sanitised](security.md#terminal-output). `--json` keeps the original text, so treat
  it as untrusted.
- Colour follows `NO_COLOR` and `FORCE_COLOR`. `DEBUG` with any value prints the stack of an
  unexpected error.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. This includes a run where some files failed, which print warnings |
| 1 | A check failed: `doctor` found a problem, or an `apply` or `undo` left ops failed |
| 2 | Usage, config or provider error: bad flags, invalid config, no key, rejected key, Node.js too old, or every file in a run failed |
| 130 | Stopped with Ctrl-C, as a shell reports it. Cached answers stay, and an `organize` stores no plan |

## Command map

| Command | Tools |
| --- | --- |
| `jevonganize` | None. Starts `server/start.ts` |
| `setup` | `set_api_key`, `add_library`, `list_facets`, `set_enabled`, `scan`, `estimate` |
| `scan` | `add_library` (for a new path), `scan` |
| `organize` | `estimate`, `organize`, `apply_plan` (with `--apply`) |
| `plans` | `list_plans` |
| `apply` | `apply_plan` |
| `undo` | `undo_plan` |
| `tags list` | `list_tags` |
| `tags add`, `tags remove` | `propose_changes`, `apply_plan` (with `--apply`) |
| `tags rename` | `rename_tag`, `apply_plan` (with `--apply`) |
| `search` | `search_files` |
| `show` | `get_file` |
| `similar` | `similar_files` |
| `review` | `list_reviews`, `resolve_reviews`, `apply_plan` |
| `suggest` | `suggest_tags` |
| `facets list`, `facets show` | `list_facets` |
| `facets enable`, `facets disable` | `set_enabled` |
| `config get` | `get_config` |
| `config set` | `set_config` |
| `config path`, `config edit` | None. Local file operations |
| `auth set` | `set_api_key` |
| `auth list` | `list_keys` |
| `auth remove` | `remove_api_key` |
| `auth env` | `set_env_keys`, `list_keys` |
| `ask` | None directly. Runs `chat()` from `ai/chat.ts`, which calls `agent: true` tools |
| `cleanup` | `cleanup_report` |
| `doctor` | `doctor` |
| `mcp` | Serves every `agent: true` tool. See [llm-native.md](llm-native.md) |

These tools have no command: `status`, `list_libraries`, `list_folders`, `remove_library`, `browse_dirs`,
`save_facet`, `delete_facet`, `cancel_job`, `reveal_file`, `list_vocabulary`, `set_vocabulary`. Use
the UI. Facets can also be edited as
files, see [presets.md](presets.md), and Ctrl-C stops a job in the terminal.

## Files and queries

A `<file>` argument is a path or a numeric file id. A path is looked up in the index, so an unindexed
file is an error that suggests `scan`.

Commands marked "query flags" accept these, which fill a `FileQuery`:

| Flag | Field |
| --- | --- |
| `--folder <path>` | `folder` |
| `--tag <tag>` | `tags`. Repeatable, and all must match unless `--tag-match any` says otherwise |
| `--tag-match <mode>` | `tag_match`: `all` (the default) or `any` |
| `--not-tag <tag>` | `exclude_tags`. Repeatable |
| `--mime <type>` | `mime`, such as `application/pdf` or `image/*` |
| `--status <status>` | `status`: `new`, `organized` or `failed` |
| `--sort <key>` | `sort`: `name`, `modified`, `size` or `relevance` |
| `--order <order>` | `order`: `asc` or `desc` |
| `--limit <n>` | `limit` |
| `--offset <n>` | `offset` |

## `jevonganize`

Starts the server on `127.0.0.1`, opens the browser at `/auth?t=<token>`, and prints the URL. It runs
until Ctrl-C. The URL holds the session token, so treat it as a password while the server runs.

| Flag | Description |
| --- | --- |
| `--port <n>` | Use this port. Default: `port` from config, or the next free port |
| `--no-open` | Do not open a browser |

```text
$ jevonganize
http://127.0.0.1:53124/auth?t=2f9c...e81a
```

`--json` prints `{ "url": "..." }`.

## `jevonganize setup`

Asks for a key, a folder and packs, then scans and shows the cost of a first run. It writes no tags.
See [getting-started.md](getting-started.md).

| Flag | Description |
| --- | --- |
| `--provider <name>` | Provider to set a key for (default: the configured one) |
| `--folder <path>` | Library to add |
| `--packs <ids>` | Comma-separated packs to enable |
| `--yes` | Ask nothing. Needs `--folder`. A key must be stored already or piped to stdin |

Without `--yes`, it needs a terminal.

```text
$ jevonganize setup
OpenAI API key: ****************
Folder to organize: ~/Downloads
Packs: core, time, sensitivity, media
Scanned 412 files in ~/Downloads.
Next: jevonganize organize ~/Downloads --dry-run
```

## `jevonganize scan [path]`

Updates the index. Free and local: no file content leaves the machine. With no `path`, it scans every
library. A `path` that is in no library is added as one first.

Files matching the [secret exclusions](security.md#built-in-secret-exclusions) or `exclude` are
skipped, and the count is reported.

```text
$ jevonganize scan ~/Downloads
Scanned ~/Downloads: 412 files, 37 new, 2 changed, 3 restore items.
Skipped 6 by exclusion rules.
```

## `jevonganize organize <path>`

Classifies files in a library and produces a plan. **It always produces a plan, and it writes no tag
to any file unless you pass `--apply`.** This run does call the model, which costs money and sends
[file data](security.md#what-leaves-your-machine) to the provider. The answers are cached, so the
money is not spent twice.

`--dry-run` stops earlier: it calls only `estimate`. It makes no model call and stores no plan.

| Flag | Description |
| --- | --- |
| `--dry-run` | Print the `Estimate` and stop. Needs no key |
| `--apply` | Apply the plan when it is ready. Items in the review band stay in the queue |
| `--facets <ids>` | Comma-separated facet ids or packs, replacing the enabled set for this run |
| `--limit <n>` | Organize at most this many files |

`--dry-run` with `--apply` is a usage error. `path` must be in a library, so run `scan` on it first.
With no key for the provider, the command refuses to start. It never falls back to another provider.

The estimate goes to stderr before the first model call. Ctrl-C cancels: cached answers stay, and no
plan is stored.

```text
$ jevonganize organize ~/Downloads --dry-run
412 files, 38 cached, 9 facets
About 1.4M tokens, about $0.14 on openai gpt-6-luna
Nothing was sent.

$ jevonganize organize ~/Downloads
About 1.4M tokens, about $0.14 on openai gpt-6-luna
Organizing 412/412
Plan 7f3a9c21: organize ~/Downloads
  387 files, 1,204 tags added, 0 removed
  doc-type:invoice      61
  doc-type:photo       140
  doc-date:2026         88
  ...
52 items need review: jevonganize review
Nothing was written. Run: jevonganize apply 7f3a9c21
```

`--dry-run --json` prints the `Estimate`. Otherwise `--json` prints NDJSON `Job` lines, and the last
holds `plan_id`. With `--apply`, the `apply` job's lines follow.

## `jevonganize plans [id]`

Lists plans, newest first. With an `id`, prints that plan's summary, and with `--json`, the whole
`Plan`.

| Flag | Description |
| --- | --- |
| `--status <status>` | `proposed`, `applying`, `applied`, `undone` or `failed` |

```text
$ jevonganize plans --status proposed
7f3a9c21  organize  387 files  +1,204 -0  organize ~/Downloads
c40de117  mcp        61 files  +61 -0     Tag tax documents
```

## `jevonganize apply <id>`

Applies a stored plan. For each op it reads the file's tags fresh, merges, writes, and updates the
index. Exit 1 if any op failed. The others stay applied.

```text
$ jevonganize apply 7f3a9c21
Applied 7f3a9c21: 387 files, 1,204 tags added.
Undo: jevonganize undo 7f3a9c21
```

## `jevonganize undo <id>`

Reverses an applied plan, merging into a fresh read of each file's tags. Exit 1 if any op failed.

```text
$ jevonganize undo 7f3a9c21
Undid 7f3a9c21: 387 files.
```

`--json` on `apply` and `undo` prints NDJSON `Job` lines.

## `jevonganize tags`

`add`, `remove` and `rename` store a plan and print it. Like `organize`, they change nothing unless
you pass `--apply`. `<path>` is a file or a folder.

| Command | Description |
| --- | --- |
| `tags list` | Tags with counts. `--folder <path>` and `--facet <id>` narrow it |
| `tags add <path> <tag...>` | Plan to add tags. Takes query flags to narrow the files |
| `tags remove <path> <tag...>` | Plan to remove tags. Takes query flags |
| `tags rename <from> <to>` | Plan to rename a tag on every file that has it |

| Flag | Description |
| --- | --- |
| `--apply` | On `add`, `remove` and `rename`: apply the plan at once |

```text
$ jevonganize tags list --facet doc-type
doc-type:photo      140
doc-type:invoice     61
doc-type:receipt     33

$ jevonganize tags add ~/Downloads project:acme --tag doc-type:invoice
Plan a18b02f4: add project:acme
  61 files, 61 tags added, 0 removed
Nothing was written. Run: jevonganize apply a18b02f4

$ jevonganize tags rename doc-type:bill doc-type:invoice --apply
Plan 90be77d3: rename doc-type:bill to doc-type:invoice
Applied 90be77d3: 4 files.
```

Invalid tags are refused. Grammar is in [tags.md](tags.md).

## `jevonganize search [text]`

Searches the index by text and file name. Takes query flags. Default `--limit` is 50.

```text
$ jevonganize search "acme" --tag doc-type:invoice --sort modified --order desc
~/Downloads/invoice-44.pdf   212 KB  2026-03-02  doc-type:invoice doc-date:2026-03 +1
~/Downloads/invoice-43.pdf   198 KB  2026-02-03  doc-type:invoice doc-date:2026-02 +1
2 of 2 files
```

## `jevonganize show <file>`

Prints a file's `FileDetail`: facts, tags, metadata, answers and pending reviews.

```text
$ jevonganize show ~/Downloads/invoice-44.pdf
~/Downloads/invoice-44.pdf  (id 1042)
PDF, 212 KB, modified 2026-03-02, organized
Tags     doc-type:invoice  doc-date:2026-03  project:acme
Answers  doc-type invoice 0.97 / invoice-state unpaid 0.62
Review   invoice-state:unpaid 0.62
```

## `jevonganize similar <file>`

Lists similar files, best first.

| Flag | Description |
| --- | --- |
| `--limit <n>` | Files to list (default 20) |

```text
$ jevonganize similar ~/Downloads/invoice-44.pdf --limit 2
0.94  ~/Downloads/invoice-43.pdf  doc-type:invoice project:acme
0.91  ~/Downloads/invoice-41.pdf  doc-type:invoice project:acme
```

## `jevonganize review`

Lists items waiting for a person, or resolves them. Accepting writes tags at once.

| Flag | Description |
| --- | --- |
| `--tag <tag>` | Only this tag |
| `--limit <n>` | Items to list |
| `--accept <ids>` | Accept comma-separated ids, or `all`, which needs `--tag` |
| `--reject <ids>` | Reject comma-separated ids, or `all`, which needs `--tag` |

```text
$ jevonganize review
invoice-state:unpaid (14)
  301  0.62  ~/Downloads/scan-0041.pdf
  302  0.66  ~/Downloads/IMG_2231.jpg
  ...
restore: doc-type:contract (1)
  317  n/a   ~/Downloads/contract.docx  Tag gone after a save

$ jevonganize review --tag invoice-state:unpaid --accept all
Accepted 14 items.
```

## `jevonganize suggest <file>`

Asks the `[chat]` model for candidate tags, and adds them to the review queue. It sends the file's
extracted state to that provider, and sends it again to `[provider]`, which verifies each candidate.
So both need a key. It writes no tag.

```text
$ jevonganize suggest ~/Downloads/invoice-44.pdf
Added 2 review items:
  318  project:acme
  319  party:acme-corp
```

## `jevonganize facets`

| Command | Description |
| --- | --- |
| `facets list` | Packs and facets, with `*` on enabled ones |
| `facets show <id>` | One facet: kind, question, labels, `applies_to` |
| `facets enable <ids...>` | Enable packs or facets |
| `facets disable <ids...>` | Disable packs or facets |

```text
$ jevonganize facets list
* core      doc-type, topic, language, status
* time      doc-date, period, event-date
  finance   invoice-state, amount, currency, tax-year
```

## `jevonganize config`

| Command | Description |
| --- | --- |
| `config get [key]` | Print the config, or one key such as `thresholds.apply`. No keys or secrets are in it |
| `config set <key> <value>` | Validate and save one key. The value is parsed as TOML |
| `config path` | Print the config, data and cache paths |
| `config edit` | Open the config in `$VISUAL` or `$EDITOR` (default `vi`, or `notepad` on Windows), then validate. An invalid file is never saved |

```text
$ jevonganize config set thresholds.apply 0.9
thresholds.apply = 0.9

$ jevonganize config set exclude '["node_modules", ".git", "*.tmp", "Archive"]'
```

`--json` on `config get` prints the tool's output: the config and its JSON Schema. See
[configuration.md](configuration.md).

## `jevonganize auth`

| Command | Description |
| --- | --- |
| `auth set <provider>` | Prompt for a key and store it. Pipe the key in for scripts. It is never a flag, which would land in shell history |
| `auth list` | Show each provider and where its key comes from. Keys are never printed |
| `auth remove <provider>` | Delete a stored key |
| `auth env on\|off` | Allow or refuse keys from environment variables. Off until you allow it |

```text
$ jevonganize auth list
openai      file
typesafe    none
openrouter  env
```

## `jevonganize ask "<natural language>"`

Runs one request through the chat model, with the same tools as the chat panel. It can search and
propose, and a plan needs a person. See [llm-native.md](llm-native.md#ask).

In a terminal, `ask` shows the plan and asks `Apply? [y/N]`. In a pipe, it prints the plan id and
stops, so `apply` stays a separate step.

```text
$ jevonganize ask "tag all 2026 scans from Acme as invoices"
search_files: 214 matches
Plan 3e1fb9a0: add doc-type:invoice
  214 files, 211 tags added, 0 removed
Apply? [y/N]
```

`--json` prints NDJSON, one event per line: `{ "type": "text", "text" }`,
`{ "type": "tool", "tool", "input", "output" }`, and `{ "type": "needs_approval", "plan_id" }`.

## `jevonganize cleanup`

Prints the `cleanup_report`: near-duplicate tags, tags on one file, and over-broad tags. It changes
nothing. Act on it with `tags rename`.

```text
$ jevonganize cleanup
Near-duplicates
  project:acme / project:acme-corp   15
One file
  topic:rugby
Over-broad
  doc-type:document   on 71% of files
```

## `jevonganize doctor`

Checks the runtime, the key, each library's volume and optional tools. Exit 1 if a required check
fails. A missing optional tool does not fail it.

```text
$ jevonganize doctor
ok    Node.js 24.22.1
ok    openai key present (file)
ok    ~/Documents can store tags
FAIL  /Volumes/USB cannot store tags
note  ffmpeg not found: video keyframes are skipped
note  soffice not found
```

## `jevonganize mcp`

Runs the MCP server over stdio, for coding agents. stdout carries only MCP messages. Clients start
this command, so you rarely run it yourself. See [llm-native.md](llm-native.md#mcp-server).

| Flag | Description |
| --- | --- |
| `--allow-apply` | Let `apply_plan`, `undo_plan`, `organize` and `suggest_tags` run with no person. Off by default |
