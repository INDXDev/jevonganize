# Changelog

This project follows [Semantic Versioning](https://semver.org).

## Unreleased

## 0.1.0 - 2026-11-07

First release. The npm package of this version was published by hand, so it has no provenance.
Later versions are published from CI with provenance. The Windows and Linux desktop builds have not
been tried by hand yet: please report what you find.

- Chat answers come as plain sentences. The panel shows plain text, so Markdown from the model
  showed as raw `**` marks.
- Desktop downloads have fixed names per system, such as `Jevonganize-macOS-arm64.dmg`. The README
  and each release's notes link a download for macOS, Windows and Linux.
- A read-only web demo of the UI on fictional files, at https://jevonganize-demo.vercel.app/.
  `pnpm deploy:demo` builds and deploys it from `webdemo/`.
- The README opens with a short demo video of the app on a folder of fictional files.
- Releases go to npm and to one GitHub Release, which holds the macOS, Windows and Linux builds, the
  npm tarball and `SHA256SUMS.txt`. Its notes come from this file. See `docs/releasing.md`.
- `pnpm build` on Windows no longer deletes the web UI it has just built, so the Windows app and a
  package built there have a UI.
- The app starts when its port and the next 19 are all taken, as WSL or Docker can do on Windows: it
  takes any free port instead of quitting at once. A port in a range Windows reserves counts as taken.
- The rail has six screens: Files, Folders, Tags, Dashboard, Questions (分類項目, the facets editor)
  and Settings, reached with `g b`, `g v`, `g t`, `g d`, `g f` and `g s`. Organize, Review and Names
  are now part of Tags, and the history of jobs and plans moved to the Dashboard. Old links and the
  keys `g o`, `g r`, `g n` and `g a` still lead to the new places, for one release. The guided tour
  walks through the new rail, Favorites and a tag's actions.
- Add virtual folders: saved, named tag rules that collect every matching file on their own, like a
  channel collects a hashtag. Nothing on disk moves. A folder inside another narrows it, and an Auto
  tree offers one folder per tag namespace and value, which can be pinned. Dropping files on a folder,
  or `folders put`, plans its home tag, so it can be seen first and undone. See the Folders screen and
  `jevonganize folders`. The index moves to schema version 5.
- Folders has a screen of its own: the folder tree, suggested folders that one click creates, and the
  Auto tree on the left, and the open folder's rule above its files as chips that `×` and `+` edit in
  place. With no folder yet, the best suggestions show as cards. Suggestions come from large tags,
  tags that go together and the parents of hierarchical tags, and read only tag counts in the index:
  no model, no cost, nothing sent. The New folder dialog offers existing tags as you type, with their
  counts, suggests tags that narrow the rule, counts the matching files live and names the folder
  after its first tag. "Make a folder from these files" starts one from the tags a selection shares.
- Favorite tags: the Files sidebar has a Favorites section in place of virtual folders. Press ☆ on a
  tag chip in the inspector, on a row of the Tags tree or in a tag's detail pane, or "Add to
  favorites" in the palette, to pin a tag there. A click on a favorite filters the tab to that tag,
  files dropped on it get the tag through a plan you apply, and dragging rows reorders them. A starred
  tag stays listed when no file carries it, and follows a move or rename of its tag. Chat and MCP can
  list favorites but not change them. The index moves to schema version 6.
- One Tags screen: the tags show as a tree, each facet a root and each `/` part a level, with the
  files carrying the tag itself and those carrying it or a tag under it. Drag a tag onto another to
  move it under that one, or to the edge of a row to move it to the top. A tag's detail pane has its
  path, rename (with the tags under it), move, remove, Refresh, its review items, redundant parents
  to clear, the tags under it and the tags often with it, Show files and Make a folder. Review
  (要確認) and Names (固有名詞) are tabs of the screen, a few facets get tabs of their own, and Run
  organize opens Organize (整理) as a drawer. Every move or rename is a plan that says which tags
  merge, and applying it also moves the vocabulary, the virtual folders and the favorites that name
  the old paths; undo puts all of it back. Only open facets and plain tags move, never across facets,
  and no deeper than six levels.
- The Dashboard shows model usage over the last 7, 30 or 90 days: cost and tokens, the share of
  files organized and open reviews, a daily cost chart stacked by feature, tables by feature and by
  model, and each library's files, failures and last scan, kinds of file and the top tags. Amounts
  are marked "≈" as estimates, and calls with no known price are counted apart. The history of jobs
  and plans sits beside it, with its plan filter in `plans=`. Every model call is now recorded in the
  local index for this: organize, refresh, tag suggestions, topic picks, proper names and chat, with
  input and output tokens and an estimated cost. Nothing leaves the machine, and rows older than 365
  days are deleted. A job's tokens now count output as well as input, and match what is recorded.
  Estimates before a run still count input only.
- New commands and tools: `jevonganize folders suggest` lists folders worth saving, and with `--tags`
  the tags that would narrow a rule. `jevonganize report usage` sums model calls by day, week or
  month, feature and model, and `jevonganize report library` shows files per library by state, kinds
  of file, top tags, reviews, plans and the cache hit rate. `jevonganize tags tree` prints the tag
  tree, `tags move <tag> --under <parent>` or `--top` moves a tag with every tag under it, and `tags
  rename --children` renames a parent with everything under it. `cleanup` lists redundant parents, a
  tag carried with its own parent. The tools behind them are `suggest_vfolders`,
  `suggest_vfolder_tags`, `usage_report` (with `by_bucket_feature`), `library_report`,
  `list_tag_tree`, `move_tag`, `list_favorite_tags` and `set_favorite_tag`.
- Refresh a tag: the Refresh button on a tag, or `jevonganize refresh <tag>`, finds files that lack
  it but look like the files that have it, by their words, the tags that go with it and similar
  files. The decision model checks each one, after an estimate, and the likely ones wait in Review.
  Nothing is tagged until you accept.
- Excel and PowerPoint files preview as a drawn page again, not as raw bytes.
- A double click, or the Open button in the inspector, opens a file in its default app. Executables,
  scripts, links and files with no extension are refused, and Reveal shows them instead.
- Add a topic catalog of public subject names. `topics pick` sends a folder's file names to the
  decision model, which weighs every topic and adds the 100 best to `topic`. `setup` does this too.
- First run now chooses topics, organizes and reads proper names by itself, in `setup` and the UI.
  `organize` applies its plan unless `--no-apply`, and `thresholds.apply` defaults to 0.5, so nothing
  waits for review. Sensitivity facets no longer need 0.95.
- The folder picker works like a Finder list, with sorting, a filter and places. Onboarding can use
  `OPENAI_API_KEY` from the environment with one click. A folder it cannot open says so, instead of
  reporting an internal error.
- Organize manages topics.
- Onboarding has a Topics step: search the catalog, or let the model choose, and remove any pick.
- `organize` also reads proper names: the decision model finds files that hold them, a light model
  reads them out, and they join the run's plan as `entity:` tags, outside `max_tags`. New `[ner]`
  setting and `names` pack. Names on the Tags screen and `names add` manage them.
- Settings are grouped by task (Basics, AI, Tags and questions, Advanced), with plain page names, a
  description on each page and a search box. One AI models page explains the decision model, which
  decides every tag, the chat model and the name-reading model. Chat and name reading can follow the
  decision model. Only the fields a service uses are shown, with defaults as placeholders, help text
  and inline checks. Config keys are unchanged.
- A short guided tour follows onboarding, once per viewer. Start it again from Settings or the
  command palette.

- Reuse extraction workers, PDF parses and recent unchanged extraction results; skip image rendering
  and encoding when images are disabled. Merge simultaneous thumbnail requests and prioritize
  previews over queued background extraction.
- Speed up scan tag reads, search pages, exact similarity and tag cleanup. Unchanged scans no longer
  rebuild all similarity weights. Installation and build commands need no new dependencies.
- A repeat organize no longer reads a file when nothing about it changed and every answer is cached.
- Unchanged scans, CLI startup, thumbnails of PDFs, and the first window of the desktop app are
  faster. `--json` job output now reports progress about four times a second, not once per file.
- An `.eml` is read only as far as its first 2 MiB, so a body after large attachments is not seen.
- The desktop app is about 114 MB smaller.

- Follow the PC's language by default, with English, Japanese and Simplified Chinese interfaces.
  Override it in Settings or with `config set language en|ja|zh-CN|system`; CLI help and the shared
  browser/desktop UI use the same preference.

- View options in the Files toolbar, as in Finder: tiles per row, thumbnail size, spacing and fit, list
  columns, text size and file extensions. They are saved in the new `[view]` config.
- Dotfiles are hidden from the file list by default, and from Organize and chat scopes with them.
  `Mod+Shift+.` shows them.
- Walk into subfolders from the list, show only a folder's own files, sort by kind, and double-click
  for a preview.

- Scan folders into a local index, and keep it current with a watcher. Both are free and send nothing.
- Organize files with a decision model: extract locally, ask every enabled question in one call per
  file, cache raw answers, and sort results by confidence into a plan and a review queue.
- Write tags only after a person applies a plan, and undo any plan. Files are never moved, renamed,
  edited or deleted.
- Tags live on the files: Finder tags on macOS, `user.xdg.tags` on Linux, and one NTFS stream on
  Windows. CI runs real tag writes on Ubuntu and Windows Server. Explorer, Dolphin and packaged Linux
  and Windows apps have not been tested.
- On Windows, a save that recreates a file deletes its tag stream. The next scan raises `restore`
  items for those tags, as it does for a save by rename.
- 10 packs of preset facets, and custom facets in TOML. A `level` step named `none` writes no tag, and
  `visibility` says whether a file is public.
- Providers: OpenAI (recommended), TypeSafe Jev, Cloudflare Clef, OpenRouter, Vercel AI Gateway,
  compatible endpoints and chat models.
- A crash during `apply` loses no undo: applying the plan again finishes it, and undo covers both
  runs. Only one `apply` of a plan can run, across the CLI and the server.
- A library that suddenly has no files keeps its index rows and warns, so an unplugged drive does not
  read as every file deleted.
- The UI does everything the CLI does: a rail of screens, Organize with live progress, cost
  and cancel, a Tags screen, and Settings > Health. Bulk tag removal, `suggest`, key removal and
  JSON editing of `pipeline` and `profiles` are there too.
- The UI follows the system's light or dark appearance, and either can be pinned.
- Tags have colours: automatic by facet, and changed per tag or per facet on the Tags screen.
- Thumbnails for HTML, text, mail, Office files and video, the same on every OS.
- `qlmanage` is gone: it put a Quick Look icon in the Dock on every run. Without `soffice`, old Office
  files now send no content, and without `ffmpeg`, video sends only its metadata.
- HTML renders in the preview, sandboxed and with nothing remote loaded. Audio and video play, and
  slides and sheets show a picture. The inspector's preview is larger and opens full size.
- Choosing several tags in the UI now shows files with any of them, with a switch to require all.
  `FileQuery.tag_match` and `--tag-match` carry this. The CLI and API still default to `all`.
- Third-party licenses are listed in `THIRD_PARTY_NOTICES.md`, including two LGPL packages.
- Three shells over one server: CLI, browser and an unsigned Electron app. An MCP server serves the
  same tools to coding agents, with an approval gate.
