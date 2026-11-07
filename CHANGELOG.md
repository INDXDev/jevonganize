# Changelog

This project follows [Semantic Versioning](https://semver.org).

## Unreleased

First version, not released yet.

- Releases go to npm and to one GitHub Release, which holds the macOS, Windows and Linux builds, the
  npm tarball and `SHA256SUMS.txt`. Its notes come from this file. See `docs/releasing.md`.
- `pnpm build` on Windows no longer deletes the web UI it has just built, so the Windows app and a
  package built there have a UI.

- Refresh a tag: the Refresh button on a tag, or `jevonganize refresh <tag>`, finds files that lack
  it but look like the files that have it, by their words, the tags that go with it and similar
  files. The decision model checks each one, after an estimate, and the likely ones wait in Review.
  Nothing is tagged until you accept.
- Add virtual folders: saved, named tag rules that collect every matching file on their own, like a
  channel collects a hashtag. Nothing on disk moves. A folder inside another narrows it, and an Auto
  tree offers one folder per tag namespace and value, which can be pinned. Dropping files on a folder,
  or `folders put`, plans its home tag, so it can be seen first and undone. See the Folders section of
  the sidebar and `jevonganize folders`. The index moves to schema version 5.
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
- The Organize screen manages topics.
- Onboarding has a Topics step: search the catalog, or let the model choose, and remove any pick.
- `organize` also reads proper names: the decision model finds files that hold them, a light model
  reads them out, and they join the run's plan as `entity:` tags, outside `max_tags`. New `[ner]`
  setting and `names` pack. The Names screen and `names add` manage them.
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
- The UI does everything the CLI does: a rail of screens, an Organize screen with live progress, cost
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
