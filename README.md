<p align="center">
  <a href="#try-it"><img src="docs/assets/hero.svg" alt="Jevonganize: tags on your files, nothing moves" width="820"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A524.22.1-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24.22.1 or later">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-a6e3a1" alt="MIT license"></a>
</p>

<p align="center">
  <a href="docs/getting-started.md"><b>Get started</b></a> &nbsp;·&nbsp;
  <a href="docs/concepts.md"><b>Concepts</b></a> &nbsp;·&nbsp;
  <a href="docs/cli.md"><b>CLI</b></a> &nbsp;·&nbsp;
  <a href="docs/presets.md"><b>Presets</b></a> &nbsp;·&nbsp;
  <a href="docs/README.md"><b>Docs</b></a>
</p>

# Jevonganize

**Organize the files you already have: a decision model tags them, and the tags live on the files.**

Jevonganize reads each file, asks a model typed questions about it, and writes the answers as tags
the operating system stores on the file. You see every change as a plan first, and you can undo it.

It writes tags only. It never moves, renames, edits or deletes a file.

**Status: early.** Version 0.1.0 is not released, and the package is not on npm yet. macOS is the only
platform anything has run on. The Linux and Windows code has never been tested.

<!-- Screenshots: docs/assets/screenshots/browser.png and friends go here once they exist. -->

## Try it

Until the first release, build from source. You need Node.js 24.22.1 or later (or 26.12.1 on that
line) and pnpm 12.

```sh
git clone https://github.com/INDXDev/jevonganize.git
cd jevonganize
pnpm install
pnpm build
node dist/cli.mjs
```

This starts a local server and opens your browser. Scanning and browsing need no API key and send
nothing. To organize, paste an OpenAI key when asked. The screen shows what will be sent and what it
will cost before anything leaves your machine.

Want a safe first target? Point it at [`examples/messy-downloads`](examples/messy-downloads/), a
small folder of fictional files.

After the first release, this will be:

```sh
npx jevonganize   # not published yet
```

## How it works

1. **Scan.** Jevonganize indexes a folder. This is free and local.
2. **Extract.** It reads text, images and metadata on your machine, in isolated workers.
3. **Decide.** One model call per file answers every enabled question. Answers are cached, so a file
   is not paid for twice.
4. **Plan.** High-confidence tags join a plan, and the middle band goes to a review queue. Nothing has
   been written yet.
5. **Apply.** You approve the plan, and the tags are merged onto the files. A plan can be undone.

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

| Shell   | Start it                                             | Notes                                                                                                |
| ------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Browser | `jevonganize`                                        | A local server on `127.0.0.1`, guarded by host, origin and token checks                              |
| Desktop | Download from GitHub Releases, once a release exists | The same UI in its own window. No Node.js needed. Builds are unsigned, so macOS and Windows warn you |
| CLI     | `jevonganize scan`, `organize`, `apply`, `search`    | `--json` on every command. See the [CLI reference](docs/cli.md)                                      |

Coding agents get a fourth door: `jevonganize mcp` serves the same tools over stdio. Applying a plan
needs a person's approval. See [LLM-native use](docs/llm-native.md).

The same flow in a terminal:

```sh
jevonganize auth set openai
jevonganize scan ~/Downloads               # free and local
jevonganize organize ~/Downloads --dry-run # shows the cost, sends nothing
jevonganize organize ~/Downloads           # sends file data, writes no tags
jevonganize apply <plan id>                # now tags are written
jevonganize undo <plan id>
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

| Action                                               | What leaves your machine                                                                                                 | To                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Scan, watch, search, review, similar files, browsing | Nothing                                                                                                                  |                    |
| `organize --dry-run`, cost estimates                 | Nothing                                                                                                                  |                    |
| Apply, undo, tag changes                             | Nothing                                                                                                                  |                    |
| Organize                                             | Per file: its name but not its folder, up to 8,000 characters of text, up to 2 small images, metadata, and the questions | Your provider      |
| Tag suggestions                                      | The same, plus your tag vocabulary                                                                                       | Your chat provider |
| Verifying a suggestion                               | The same state again, and one yes-or-no question per candidate tag                                                       | Your provider      |
| Chat panel, `ask`                                    | Your messages, and names, paths, tags and metadata from tool calls. No file text                                         | Your chat provider |

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
nothing has run there yet. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
