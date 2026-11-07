# Configuration

Jevonganize works with no config. There is one user config file, and nothing else can set config.
The defaults are in [contracts.md](contracts.md#config).

## Where files live

Directories come from `env-paths`, called with an empty suffix, so they follow each OS's convention.
The CLI, the server and the desktop app all use the same ones.

| Purpose | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Config | `~/Library/Preferences/jevonganize` | `$XDG_CONFIG_HOME/jevonganize` (`~/.config/jevonganize`) | `%APPDATA%\jevonganize\Config` |
| Data | `~/Library/Application Support/jevonganize` | `$XDG_DATA_HOME/jevonganize` (`~/.local/share/jevonganize`) | `%LOCALAPPDATA%\jevonganize\Data` |
| Cache | `~/Library/Caches/jevonganize` | `$XDG_CACHE_HOME/jevonganize` (`~/.cache/jevonganize`) | `%LOCALAPPDATA%\jevonganize\Cache` |

| File | Directory | Holds |
| --- | --- | --- |
| `config.toml` | Config | Settings on this page |
| `credentials.toml` | Config | API keys, mode `0600`. See [security.md](security.md#api-keys) |
| `facets/*.toml` | Config | Custom facets. See [presets.md](presets.md) |
| `index.db` | Data | The index, answers, reviews, plans. See [storage.md](storage.md) |
| `thumbs/` | Cache | Thumbnails. Safe to delete |

`jevonganize config path` prints the paths in use.

## Editing

| Way | How | Notes |
| --- | --- | --- |
| Settings screen | Pages grouped by task, with fields from the config's JSON Schema. See [ui.md](ui.md#settings) | Saves through `set_config` |
| CLI | `jevonganize config set <key> <value>` | Saves through `set_config` |
| File | `jevonganize config edit`, or any editor | `config edit` refuses to save an invalid file. Any other editor can, and the next load reports it |

All three end up in the same file. `set_config` changes the keys you set and keeps the others, but it
rewrites the file, so **comments and key order are lost**. If you keep comments, edit by hand.

A running server reads the file when it starts. Changes made in Settings or with `config set` take
effect at once. A hand edit takes effect after a restart.

An API key never goes in this file. See [Validation](#validation).

## Validation

One zod schema in `core/config.ts` validates the file, `set_config` and the settings form.

- Unknown keys are errors.
- Every problem is reported at once, by key path, not just the first.
- Error messages never quote a TOML line, because that line may hold a secret.
- An `api_key` key in any settings table is refused as an unknown key.
- `thresholds.apply` and `thresholds.review` are each between 0 and 1.
- `set_config` validates first, so an invalid change never reaches the file.
- The file is written atomically and synced to disk, and it keeps its mode.

| Entry point | With an invalid file |
| --- | --- |
| CLI | Stops with exit 2 and lists the problems |
| Starting the server | Stops with exit 2 and lists the problems |
| Running server | Keeps the config it started with. The problems show at the next start |

An error in one custom facet file does not stop anything. That file is skipped with a warning.

## No per-folder config

There is no `jevonganize.toml` found by walking up from a folder, and no project layer. Settings
come from the user file and command-line flags only.

The reason is the input. Jevonganize runs on folders such as Downloads, where unpacking a zip can
plant any file. A config found in a folder could change the provider, the `base_url`, or the
exclusions, and send your files or your key somewhere you did not choose. With no folder config,
that whole class of attack does not exist.

## Top-level keys

| Key | Default | Meaning |
| --- | --- | --- |
| `language` | `"system"` | Interface language: PC default, `"en"` (English), `"ja"` (日本語), `"zh-CN"` (简体中文) |
| `port` | `48620` | Port for the local server, 1024 to 65535. The next free port is used if this one is taken |
| `concurrency` | `8` | Maximum parallel model calls |
| `max_tags` | `10` | Hard cap of tags per file on what organize adds, counting tags a person added but not `entity:` names |
| `fiscal_year_start` | `4` | First month of the fiscal year, 1 to 12, for `fiscal-year` fields |
| `exclude` | `["node_modules", ".git", "*.tmp", ".DS_Store", "._*", "Thumbs.db"]` | Globs to skip. Setting it replaces this default, but it adds to the [built-in secret exclusions](security.md#built-in-secret-exclusions), which cannot be turned off |
| `send_images` | `true` | `false` keeps every image on this machine, including rendered PDF pages. Scanned files then give the model little to work with |

### Interface language

By default the CLI, browser UI and desktop app follow this PC's preferred UI language. The local
server detects it, so the browser's language and `Accept-Language` do not override it. macOS reads
`AppleLanguages`, Windows reads the user's default UI language, and Linux uses the session locale
(`LC_ALL`, `LC_MESSAGES`, then `LANG`; `LANGUAGE` overrides the message language outside `C`/`POSIX`
sessions). The preference is detected once per process; restart after changing the PC language.
Japanese variants use Japanese, Chinese variants use Simplified Chinese,
and unsupported languages use English.

Choose another language in Settings > Language and help > Language, or set it directly:

```sh
jevonganize config set language ja
jevonganize config set language en
jevonganize config set language zh-CN
jevonganize config set language system
```

Saving in Settings changes the current window immediately. A CLI invocation reads the setting
before building its help. Startup errors before valid config is available use English.
Machine-readable output, tags, file names, facet definitions and decision prompts retain their
original values. Shared engine/tool errors and third-party diagnostics (including provider, parser,
native and Commander messages) can retain their original language.

## `[tag_colors]`

Colours in the UI, by tag or by whole facet. Change them on the Tags screen. Colours stay in this
file: they are not written to files, and Finder's own tag colours are separate.

```toml
[tag_colors]
"doc-type" = "blue"
"doc-type:invoice" = "red"
```

A value is `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`, `gray` or
`auto`. A tag's own colour beats its facet's. Anything else gets an automatic colour from its facet
name, the same on every machine. Renaming a tag does not carry its own colour over.

## `[view]`

How the file list looks. Change it from the view options in the Files toolbar (`Mod+J`), or in
Settings. It lives here rather than in the browser, so it survives a change of port and is the same
in the desktop app.

| Key | Default | Meaning |
| --- | --- | --- |
| `show_dotfiles` | `false` | Show names starting with a dot, and what is in such folders. `Mod+Shift+.` switches it. Hidden files stay indexed, and a view's Organize and chat skip them too |
| `include_subfolders` | `true` | Show everything under a folder. `false` shows only what sits directly in it, except while searching or filtering by tag |
| `show_extensions` | `true` | Show file name extensions |
| `thumbnail_size` | `160` | Width of a grid tile in pixels, 64 to 512, when `grid_columns` is `0` |
| `grid_columns` | `0` | Tiles per row, up to 12. `0` fits as many as `thumbnail_size` allows |
| `grid_spacing` | `10` | Space between tiles in pixels, up to 48 |
| `thumbnail_fit` | `"cover"` | `cover` fills the tile and crops. `contain` shows the whole thumbnail |
| `grid_info` | `"tags"` | The line under a name: `tags`, `kind`, `size`, `modified` or `none` |
| `text_size` | `12` | File name size in pixels, 10 to 20 |
| `list_columns` | `["tags", "size", "modified"]` | Columns after the name: `tags`, `kind`, `size`, `modified`, `path` |
| `list_thumbnails` | `false` | Show thumbnails in the list, not icons |

To keep files out of the index altogether, use `exclude`.

## `[provider]`

The default model, used for every facet with no `profile`. See [providers.md](providers.md). In the
UI it is the **Decision model** card on Settings > AI models, the one model that decides tags.

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `"openai"` | A provider: `openai`, `typesafe`, `gateway`, `cloudflare`, `openrouter`, `compatible` or `chat` |
| `model` | `"gpt-6-luna"` | Model id |
| `base_url` | Unset | Endpoint, for providers that need one |
| `account_id` | Unset | Account, for providers that need one |

Prefer a pinned model id. A moving alias can leave cached answers from an older model in use.

## `[profiles.<name>]`

Optional extra models. A facet uses one by naming it in `profile`. Same keys as `[provider]`. There
are none by default. For example:

```toml
[profiles.vision]
name = "typesafe"
model = "jev-latest"
```

A profile is used only if a facet names it. If one does and its key is missing, the job refuses to
start. A file that reaches a profile's facet goes to that provider too.

## `[chat]`

The model for the chat panel, `ask`, and tag suggestions. Same keys as `[provider]`. In the UI it is
the **Chat model** card on Settings > AI models. Its "Same as the decision model" choice copies
`[provider]` here when saved; there is no separate key for it.

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `"openai"` | Provider |
| `model` | `"gpt-6-luna"` | Model id |

## `[ner]`

The light text model that `organize` uses to read proper names out of files. Same keys as `[provider]`.
In the UI it is the **Name-reading model** card on Settings > AI models.
It is separate from `[provider]`, so with a local `[provider]` set this too, or file text goes to OpenAI.

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `"openai"` | Provider |
| `model` | `"gpt-5.4-mini"` | Model id |

## `[facets]`

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `["core", "time", "sensitivity", "media"]` | Packs or single facet ids to use |
| `disabled` | `[]` | Packs or facet ids to leave out. Beats `enabled` |

## `[thresholds]`

Applied after the answer cache, so changing them costs no model calls.

| Key | Default | Meaning |
| --- | --- | --- |
| `apply` | `0.5` | At or above: the tag joins the plan. A facet's `apply_above` overrides this |
| `review` | `0.50` | At or above, and below `apply`: review queue. Below: dropped |
| `estimated_to_review` | `true` | Answers without native probabilities never join a plan on their own |

## `[budget]`

Limits on what is read and sent per file. Changing one changes the state, so affected files are asked
again.

| Key | Default | Meaning |
| --- | --- | --- |
| `text_chars` | `8000` | Characters of text sent, 3/4 from the start and 1/4 from the end. At the default, 6000 and 2000 |
| `pdf_pages` | `10` | PDF pages read for text |
| `render_pages` | `2` | Pages rendered to images when a PDF has little text |
| `thin_text_chars` | `200` | Characters per page below which a PDF counts as scanned |
| `images` | `2` | Images sent per file, from any source. This also caps `render_pages` |
| `image_edge` | `768` | Longest image edge in pixels |
| `sheets` | `5` | Spreadsheet sheets read |
| `sheet_rows` | `50` | Rows read per sheet |
| `zip_entries` | `200` | Entry names read from an archive. Entries are not unpacked |
| `max_parse_mb` | `200` | Larger files skip parsers that read the whole file |
| `max_office_mb` | `25` | The same limit for Office files, which inflate in memory |
| `timeout_seconds` | `30` | Time for one file's extraction. A parser that runs over is terminated, and the file is marked failed |

## `[[pipeline]]`

Which extractors run for which files. First match wins, and order within `use` is run order.

| Key | Meaning |
| --- | --- |
| `match` | MIME glob, such as `application/pdf` |
| `use` | Extractor names, in order |

The defaults are in [pipeline.md](pipeline.md). Setting any `[[pipeline]]` entry replaces the whole
default list.

## `[watch]`

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Keep the index current while the server runs |
| `walk_minutes` | `30` | Minutes between full stat walks, which catch missed events |

## Environment variables

| Variable | Effect |
| --- | --- |
| `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` | Move the directories on Linux |
| `VISUAL`, `EDITOR` | Editor for `config edit` |
| `NO_COLOR`, `FORCE_COLOR` | Terminal colour |
| `DEBUG` | Any value prints the stack of an unexpected error |

Provider key variables are in [providers.md](providers.md). They are ignored until you run
`jevonganize auth env on`.
