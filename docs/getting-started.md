# Getting started

This guide takes you from nothing to tagged files. Setup takes under two minutes. How long the first
run takes depends on the number of files.

Jevonganize never moves, renames, edits or deletes a file. It only writes tags.

## Install

**With Node.js.** You need Node.js 24.22.1 or later. Older releases are refused.

```sh
npx jevonganize
```

This starts a local server and opens your browser. To keep it installed:

```sh
npm install -g jevonganize
```

**Desktop app.** Download it from GitHub Releases. It needs no Node.js.

Builds are not signed yet. On macOS, allow the app in System Settings > Privacy & Security after the
first launch fails. On Windows, SmartScreen shows a warning. The desktop app is the same UI in its own
window.

## What is sent before you start

Read this before the first run.

`scan` and browsing are local. Nothing leaves your machine. When you **organize**, this goes to OpenAI
(or the provider you chose), for each file:

- The file's name, but not its folder path.
- Up to 8,000 characters of its text: 6,000 from the start, 2,000 from the end.
- Up to 2 images, at most 768 pixels on the long edge. For an image file, that is the image. For a
  scanned PDF, its first pages.
- Metadata such as author, title and dates.
- The questions from your enabled packs.

Set `send_images = false` to keep every image on your machine. Files such as `.env`, `*.pem` and SSH
keys are [never read](security.md#built-in-secret-exclusions). Other files are not checked for
secrets, so a password in a text file is sent like any other text.

Check OpenAI's data policy if your files are confidential. [Security](security.md#what-leaves-your-machine)
has the full table, and [Providers](providers.md) lists other options.

## Onboarding

The first launch shows one screen. It has four steps.

1. **OpenAI key.** Paste an API key. It is stored in a file only you can read. Without one, you can
   still scan and browse.
2. **Folder.** Pick a folder, such as Downloads. It is scanned at once.
3. **Packs.** Packs are sets of questions. Core, Time, Sensitivity and Media are on by default.
4. **Cost.** The screen shows what will be sent, to which provider, and what it will cost. By default
   it covers the first 200 files, about $0.07 at `gpt-6-luna` prices. Tick the box to run on all files.

Press **Organize**. Each file gets one model call, and its answers are cached, so it is never paid for
twice. No tags are written yet.

The Review screen then opens with two things.

- **The plan.** Tags with high confidence. It shows how many files get which tags.
- **The review queue.** Tags in the middle band, grouped by tag. Press `a` to accept, `r` to reject,
  `Shift+A` to accept a whole group. Accepting writes that tag at once, and `Mod+Z` undoes it.

Press **Apply** on the plan. Tags are now on your files. On macOS, open Finder to see them. Press
`Mod+Z` to undo the plan.

Tags are not visible in Explorer on Windows or in GNOME Files on Linux. See
[Troubleshooting](troubleshooting.md#tags-not-visible).

## First run in the CLI

The same flow in a terminal. Example output is shortened, and its figures are illustrative.

Store a key:

```sh
jevonganize auth set openai
```

If you already export `OPENAI_API_KEY`, skip this, and allow it when asked. It is ignored until you do.

Scan a folder. This adds it as a library, and it is free:

```text
$ jevonganize scan ~/Downloads
Scanned ~/Downloads: 412 files, 412 new.
Skipped 6 by exclusion rules.
```

See the cost. This sends nothing:

```text
$ jevonganize organize ~/Downloads --dry-run
412 files, 0 cached, 9 facets
About 1.4M tokens, about $0.14 on openai gpt-6-luna
Nothing was sent.
```

Organize. This sends file data and costs money, but it writes no tags:

```text
$ jevonganize organize ~/Downloads
Organizing 412/412
Plan 7f3a9c21: organize ~/Downloads
  387 files, 1,204 tags added, 0 removed
52 items need review: jevonganize review
Nothing was written. Run: jevonganize apply 7f3a9c21
```

Look at what it found, and settle the review queue:

```sh
jevonganize plans 7f3a9c21
jevonganize review
jevonganize review --tag doc-type:invoice --accept all
```

Apply the plan:

```text
$ jevonganize apply 7f3a9c21
Applied 7f3a9c21: 387 files, 1,204 tags added.
Undo: jevonganize undo 7f3a9c21
```

Use your tags:

```sh
jevonganize search --tag doc-type:invoice
jevonganize similar ~/Downloads/invoice-44.pdf
```

## Next

| If you want to | Read |
| --- | --- |
| Understand facets, tags and plans | [Concepts](concepts.md) |
| Choose packs or write facets | [Presets](presets.md) |
| Use another provider or a local model | [Providers](providers.md) |
| Change thresholds and budgets | [Configuration](configuration.md) |
| Drive it from Claude Code or Cursor | [LLM-native use](llm-native.md) |
| Fix a problem | [Troubleshooting](troubleshooting.md) |
