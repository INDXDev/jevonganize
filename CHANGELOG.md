# Changelog

This project follows [Semantic Versioning](https://semver.org).

## Unreleased

First version, not released yet.

- Scan folders into a local index, and keep it current with a watcher. Both are free and send nothing.
- Organize files with a decision model: extract locally, ask every enabled question in one call per
  file, cache raw answers, and sort results by confidence into a plan and a review queue.
- Write tags only after a person applies a plan, and undo any plan. Files are never moved, renamed,
  edited or deleted.
- Tags live on the files: Finder tags on macOS, `user.xdg.tags` on Linux, and one NTFS stream on
  Windows. Linux and Windows have not been tested.
- 10 packs of preset facets, and custom facets in TOML. A `level` step named `none` writes no tag, and
  `visibility` says whether a file is public.
- Providers: OpenAI (recommended), TypeSafe Jev, Cloudflare Clef, OpenRouter, Vercel AI Gateway,
  compatible endpoints and chat models.
- A crash during `apply` loses no undo: applying the plan again finishes it, and undo covers both
  runs. Only one `apply` of a plan can run, across the CLI and the server.
- A library that suddenly has no files keeps its index rows and warns, so an unplugged drive does not
  read as every file deleted.
- Third-party licenses are listed in `THIRD_PARTY_NOTICES.md`, including two LGPL packages.
- Three shells over one server: CLI, browser and an unsigned Electron app. An MCP server serves the
  same tools to coding agents, with an approval gate.
