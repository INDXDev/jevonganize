<p align="center">
  <a href="#try-it"><img src="docs/assets/hero.svg" alt="Jevonganize: tags on your files, nothing moves" width="820"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A524.22.1-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24.22.1 or later">
  <a href="https://www.npmjs.com/package/jevonganize"><img src="https://img.shields.io/badge/npm-jevonganize-cb3837?logo=npm&logoColor=white" alt="jevonganize on npm"></a>
  <a href="https://github.com/INDXDev/jevonganize/releases/latest"><img src="https://img.shields.io/badge/download-macOS_%7C_Windows_%7C_Linux-555?logo=github" alt="Download the desktop app"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-a6e3a1" alt="MIT license"></a>
  <a href="https://jevonganize-demo.vercel.app/"><img src="https://img.shields.io/badge/web_demo-try_it-0a66ff?logo=vercel&logoColor=white" alt="Try the web demo"></a>
</p>

<p align="center">
  <a href="docs/getting-started.md"><b>Get started</b></a> &nbsp;·&nbsp;
  <a href="docs/concepts.md"><b>Concepts</b></a> &nbsp;·&nbsp;
  <a href="docs/cli.md"><b>CLI</b></a> &nbsp;·&nbsp;
  <a href="docs/presets.md"><b>Presets</b></a> &nbsp;·&nbsp;
  <a href="https://jevonganize-demo.vercel.app/"><b>Web demo</b></a> &nbsp;·&nbsp;
  <a href="docs/README.md"><b>Docs</b></a>
</p>

# Jevonganize

**Organize the files you already have: a decision model tags them, and the tags live on the files.**

<p align="center">
  <a href="docs/assets/demo.mp4"><img src="docs/assets/demo-poster.png" alt="Demo video: the app tags a folder of fictional downloads, then finds files by what they are" width="820"></a>
  <br>
  <a href="docs/assets/demo.mp4"><b>▶ Watch the demo (1:27)</b></a>: the real app on a folder of
  fictional files, with a real model. Waits for the model are sped up, and the screen says so.
  <br>
  <a href="https://jevonganize-demo.vercel.app/"><b>Try the web demo</b></a>: the same UI in your
  browser, on fictional files. It is read-only, and it calls no model.
</p>

Jevonganize reads each file, asks a model typed questions about it, and writes the answers as tags
the operating system stores on the file. You see every change as a plan first, and you can undo it.

It writes tags only. It never moves, renames, edits or deletes a file.

**Status: early.** 0.1.0 is the first release. The test suite passes in CI on macOS, Ubuntu and
Windows Server, with real tag writes on each. That proves test behaviour only: Explorer, Dolphin and
packaged Linux and Windows apps have not been tried.

<!-- Screenshots: docs/assets/screenshots/browser.png and friends go here once they exist. -->

## Try it

You need Node.js 24.22.1 or later on the 24 line, or 26.12.1 or later.

```sh
npx jevonganize
```

The package is [jevonganize on npm](https://www.npmjs.com/package/jevonganize).

This starts a local server and opens your browser. Scanning and browsing need no API key and send
nothing. To organize, paste an OpenAI key when asked. The screen shows what will be sent and what it
will cost before anything leaves your machine.

Or use the desktop app, which needs no Node.js:

| System                | Download                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| macOS (Apple silicon) | [Jevonganize-macOS-arm64.dmg](https://github.com/INDXDev/jevonganize/releases/latest/download/Jevonganize-macOS-arm64.dmg)             |
| Windows x64           | [Jevonganize-Windows-x64-Setup.exe](https://github.com/INDXDev/jevonganize/releases/latest/download/Jevonganize-Windows-x64-Setup.exe) |
| Linux x64             | [Jevonganize-Linux-x64.AppImage](https://github.com/INDXDev/jevonganize/releases/latest/download/Jevonganize-Linux-x64.AppImage)       |

Every version is on [GitHub Releases](https://github.com/INDXDev/jevonganize/releases), with
`SHA256SUMS.txt`. Builds are not signed yet, so macOS and Windows warn you. See
[Getting started](docs/getting-started.md) for how to allow them.

Want a safe first target? Point it at [`examples/messy-downloads`](examples/messy-downloads/), a
small folder of fictional files.

To build from source instead, you also need pnpm 12:

```sh
git clone https://github.com/INDXDev/jevonganize.git
cd jevonganize
pnpm install
pnpm build
node dist/cli.mjs
```

## How it works

1. **Scan.** Jevonganize indexes a folder. This is free and local.
2. **Extract.** It reads text, images and metadata on your machine, in isolated workers.
3. **Decide.** One model call per file answers every enabled question. Answers are cached, so a file
   is not paid for twice.
4. **Plan.** Tags at 0.5 confidence or above join a plan. Nothing has
   been written yet.
5. **Apply.** The tags are merged onto the files, with nothing to approve. A plan can be undone.

The tags on disk are the truth. The database is only an index. Delete it, or delete Jevonganize, and
your tags stay on your files. Jevonganize never removes a tag you set yourself unless you ask it to.

See [Concepts](docs/concepts.md) and [Architecture](docs/architecture.md).

## Why decision models

A [decision model](docs/concepts.md#decision-models) reads input and answers typed questions with
labels and probabilities. It does not write prose. That suits tagging:

- **Closed output.** A model can only pick a label you defined. Text inside a file cannot make it
  invent a tag, so a hostile file can at worst mislabel itself.
- **Cheap to ask more.** You pay for input tokens, and more questions about the same file add little
  on most models.
- **Tunable later.** Raw probabilities are stored, so changing a threshold needs no new model call.

**Treat tags as opinions.** Thresholds are starting points, not measured values, and they do not carry
over between models. Do not use tags as a security control.

OpenAI's `gpt-6-luna` is the recommended default. TypeSafe Jev, Cloudflare Clef, OpenRouter, Vercel AI
Gateway, compatible endpoints and ordinary chat models also work, with limits. Chat models only
estimate a probability, so their answers go to review. See [Providers](docs/providers.md).

## Three shells

One server and one UI, three ways in. Every operation is one entry in a tool table, so they behave the
same.

| Shell   | Start it                                                                         | Notes                                                                                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser | `jevonganize`                                                                    | A local server on `127.0.0.1`, guarded by host, origin and token checks                                                                                                                                      |
| Desktop | Download from [GitHub Releases](https://github.com/INDXDev/jevonganize/releases) | The same UI in its own window, for macOS (Apple silicon), Windows and Linux. No Node.js needed. Builds are unsigned, so macOS and Windows warn you. The Windows and Linux builds have not been tried by hand |
| CLI     | `jevonganize scan`, `organize`, `apply`, `search`                                | `--json` on every command. See the [CLI reference](docs/cli.md)                                                                                                                                              |

Coding agents get a fourth door: `jevonganize mcp` serves the same tools over stdio. Applying a plan
needs a person's approval. See [LLM-native use](docs/llm-native.md).

The same flow in a terminal:

```sh
jevonganize auth set openai
jevonganize scan ~/Downloads               # free and local
jevonganize organize ~/Downloads --dry-run # shows the cost, sends nothing
jevonganize organize ~/Downloads           # sends file data, then writes tags
jevonganize undo <plan id>                 # takes them off again
```

## Presets

A **facet** is one question, such as "what kind of document is this?". A **pack** is a group of facets.
About 100 presets ship in 10 packs. Only enabled facets that apply to a file's type are asked.

| Pack           | For                                    | On by default |
| -------------- | -------------------------------------- | ------------- |
| `core`         | What a file is and how much it matters | Yes           |
| `time`         | When it dates from and what falls due  | Yes           |
| `sensitivity`  | Whether it needs care                  | Yes           |
| `media`        | Photos, screenshots, audio             | Yes           |
| `parties`      | Who wrote it, and who it involves      | No            |
| `projects`     | What work it belongs to                | No            |
| `finance`      | Money                                  | No            |
| `legal`        | Contracts and records                  | No            |
| `work`         | Office and technical files             | No            |
| `housekeeping` | Clutter                                | No            |

Write your own in a few lines of TOML:

```toml
pack = "finance"
title = "Finance"

[[facet]]
id = "invoice-state"
title = "Invoice state"
kind = "choice"
instructions = "What is the payment state of this invoice?"
applies_to = ["application/*", "image/*"]

[facet.values]
paid = "It shows the invoice was paid: a receipt, or a paid stamp."
unpaid = "It asks for payment that is still due."
```

That gives tags such as `invoice-state:paid`. See [Presets](docs/presets.md).

## Where you can see the tags

Tags are real, but not every file manager shows them. Check this before you rely on them.

| System             | Stored in                       | File manager shows them | OS search | Tested                                                             |
| ------------------ | ------------------------------- | ----------------------- | --------- | ------------------------------------------------------------------ |
| macOS Finder       | xattr, the same one Finder uses | Yes                     | Spotlight | Reads tested on macOS 14. The Finder window itself was not checked |
| Linux, KDE Dolphin | xattr `user.xdg.tags`           | Expected                | Baloo     | No                                                                 |
| Linux, GNOME Files | xattr `user.xdg.tags`           | **No. Shows nothing**   | No        | No                                                                 |
| Windows Explorer   | One NTFS stream per file        | **No. Shows nothing**   | No        | No                                                                 |

On Windows and GNOME, use Jevonganize or `jevonganize search` to see and find tags. Windows has no tag
that works on every file type, which is why the stream exists. Tags are stored per OS, and they do not
sync between systems.

Some apps drop tags when they save, and some volumes cannot store them. See [Tags](docs/tags.md) and
[Troubleshooting](docs/troubleshooting.md#tags-not-visible).

## Privacy

There is no telemetry, no account and no Jevonganize server. Your files reach only the provider you
chose, and there is no silent fallback to another one.

| Action                                                           | What leaves your machine                                                                                                 | To                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Scan, watch, search, review, similar files, browsing             | Nothing                                                                                                                  |                                           |
| `organize --dry-run`, cost estimates                             | Nothing                                                                                                                  |                                           |
| Apply, undo, tag changes                                         | Nothing                                                                                                                  |                                           |
| Interface language and PC language detection                     | Nothing                                                                                                                  |                                           |
| Short-lived extraction and hash caches                           | Nothing; bounded process memory only                                                                                     |                                           |
| Organize                                                         | Per file: its name but not its folder, up to 8,000 characters of text, up to 2 small images, metadata, and the questions | Your provider                             |
| Tag suggestions                                                  | The same, plus your tag vocabulary                                                                                       | Your chat provider                        |
| Verifying a suggestion                                           | The same state again, and one yes-or-no question per candidate tag                                                       | Your provider                             |
| Refreshing a tag                                                 | For each candidate, the same as organize, and one yes-or-no question naming the tag                                      | Your provider                             |
| `topics pick`, and `setup` when a key is present                 | File names in the folder, with no folder path or content, and one question per catalog topic                             | Your provider                             |
| Organize, for files that name people, organisations and the like | The same text, to read the names out                                                                                     | Your provider, then your `[ner]` provider |
| Chat panel, `ask`                                                | Your messages, and names, paths, tags and metadata from tool calls. No file text                                         | Your chat provider                        |

**A password inside an ordinary text file is sent like any other text.** Contents are not scanned for
secrets. Names such as `.env`, `*.pem` and SSH keys are [never read](docs/security.md#built-in-secret-exclusions).
Set `send_images = false` to keep every image here, or use a local model to keep everything here.

Files are treated as hostile: names, contents and metadata. See [Security](docs/security.md), including
[Some risks remain](docs/security.md#some-risks-remain).

## What it is not

- **Not a file mover.** No moving, renaming, deleting or de-duplicating, and that will not change.
- **Not a sync tool.** Tags do not travel between operating systems.
- **Not a hosted service.** It runs on your machine.
- **Not a verdict.** A model can be wrong, so review what it proposes.

## Docs

| If you want to                    | Read                                       |
| --------------------------------- | ------------------------------------------ |
| Go from nothing to tagged files   | [Getting started](docs/getting-started.md) |
| Understand facets, tags and plans | [Concepts](docs/concepts.md)               |
| Look up a command                 | [CLI](docs/cli.md)                         |
| Choose or write facets            | [Presets](docs/presets.md)                 |
| Pick a model                      | [Providers](docs/providers.md)             |
| Drive it from a coding agent      | [LLM-native use](docs/llm-native.md)       |
| Check what leaves your machine    | [Security](docs/security.md)               |
| Everything else                   | [Documentation index](docs/README.md)      |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Reports from Linux and Windows are especially useful, since
only CI has run there. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
