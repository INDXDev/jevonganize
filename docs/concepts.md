# Concepts

Read this first. It explains the ideas and words the other documents use.

## The problem

Most people have thousands of files they never sorted: downloads, scans, screenshots, old invoices.
Folders force each file into one place, and renaming by hand does not scale. So files are hard to
find when they matter.

Jevonganize leaves your files where they are. It reads each one, decides what it is, and writes the
result as tags the operating system stores on the file. You can then filter, search and find similar
files, and the tags stay on the files even if you delete Jevonganize.

It never moves, renames, edits or deletes a file.

## Decision models

A decision model reads some input and answers typed questions. It does not write prose. You get
labels and probabilities back:

- **Boolean**: the probability that a statement is true.
- **Choice**: one option from a closed list, usually with a probability for each option.
- **Score**: a position on a list of ordered levels.

Examples are OpenAI's `gpt-6-luna`, TypeSafe AI's Jev and Cloudflare's Clef. See
[providers](providers.md).

This suits file tagging well:

- **Closed output.** A model can only pick a label you defined, so text inside a file cannot make it
  invent a tag.
- **Cheap.** You pay for input tokens only, and asking more questions about the same file adds
  little on most models.
- **Tunable.** Raw probabilities are stored, so changing a threshold later needs no new model call.

A decision model does not read PDFs or Office files, so Jevonganize extracts text and images on your
machine first. See [pipeline](pipeline.md).

Treat answers as opinions. Different models give different numbers, and a hostile file can move an
answer. It cannot run anything.

## Facets and tags

A **facet** is one attribute of a file, such as "document type" or "year". It is a definition: the
question, the allowed labels and some settings.

A **tag** is one value of a facet, written on one file, such as `doc-type:invoice`. A tag can also be
any plain string a person wrote, such as `to-read`. Those belong to no facet.

So facets live in TOML files, and tags live on your files. One facet produces many different tags
across a library, and usually at most one on each file.

There are six kinds of facet:

| Kind | Meaning | Example tag |
| --- | --- | --- |
| `flag` | Yes or no. Present means yes | `flag:has-signature` |
| `choice` | One of a closed set | `doc-type:invoice` |
| `multi` | Any of a closed set | `topic:finance/tax` |
| `level` | One step on an ordered scale | `confidentiality:restricted` |
| `date` | A year, or a year and month | `doc-date:2026-03` |
| `field` | Copied from file metadata, with no model call | `author:yamada-taro` |

See [tags](tags.md) for how tags are stored, and [presets](presets.md) for how facets are defined.

## Presets and packs

A **preset** is a facet that ships with Jevonganize. There are about 100, plus a much larger
[topic catalog](presets.md#topic-catalog) that a model chooses from. A facet you write yourself
is a **custom facet**. Both use the same format.

A **pack** is a named group of up to 10 presets, such as `finance` or `sensitivity`. You turn on packs,
single facets, or both. Only enabled facets that apply to a file's type are asked, which keeps
requests small. The default packs are `core`, `time`, `sensitivity` and `media`.

## The two flows

Jevonganize does two separate things. Most of the time only the first one runs.

**Index** is free, local and fast. `scan` walks a library and records what it finds. `watch` keeps
that record current. No file content leaves your machine.

**Organize** reads content and calls a model. For each file it runs these steps:

1. **Select** the file and the enabled facets that apply to it.
2. **Extract** text, images and metadata.
3. **Derive** `field` facets from metadata, for free.
4. **Decide** the remaining facets, in one call per file. Cached answers are reused.
5. **Resolve** answers against [thresholds](#confidence).
6. **Plan** the result. Nothing has been written yet.
7. **Apply** the plan after you have seen it. Each file's tags are read again, merged and written.

A plan can be undone. See [architecture](architecture.md#the-two-flows).

## Confidence

Every answer comes with a number from 0 to 1. Tagging changes no file and `undo` reverses it, so by
default nothing waits for a person. Raise `thresholds.apply` above `thresholds.review` to bring back a
review band between them:

| Confidence | Default | What happens |
| --- | --- | --- |
| Applied | 0.50 or above | The tag joins the plan, and `organize` applies it |
| Low | Below 0.50 | The answer is kept in the index, and no tag is proposed |

Some answers have no usable number. Chat models only estimate one, and those answers go to review
rather than apply. See [presets](presets.md#thresholds) for the exact rules.

These thresholds are starting points, not measured values. They do not carry over between models.

## Virtual folders

A virtual folder exists nowhere on disk. It is a saved, named rule over tags, such as "files tagged
`topic:finance/tax`". Every indexed file that matches collects in it on its own, the way a chat
channel collects a hashtag, and a file can sit in many folders at once. Nothing moves.

- **Rule.** Tags, with `any` or `all` of them, tags to leave out, and an optional library folder.
  An empty rule matches every file, which suits a folder that only groups others.
- **Nesting narrows.** A folder inside another shows only files that match both, so `Taxes / 2024`
  holds the tax files tagged 2024. Folders nest up to 8 deep, and a folder cannot go inside itself.
- **Home tag.** Putting a file in a folder, by dropping it there or with `folders put`, gives it the
  folder's home tag, and the home tag of each folder above that has one. That is a
  [plan](#the-two-flows), so you see it before it runs and can undo it. A folder whose rule is one tag
  uses that tag; otherwise you name one, or nothing can be put in.
- **Generated folders.** One folder per tag namespace, such as `topic`, with a child per value, nested
  by `/`. They are computed from the tags you have and never stored. Pin one to keep it as your own.

Deleting a folder deletes the folders inside it and nothing else: files and their tags stay.

## Tags are the truth

Tags on disk are the source of truth. The database is an index of them. If you delete it, your tags
survive, but you lose paid answers and undo history. See [storage](storage.md).

Tags that Jevonganize wrote are recorded in that index. Any other tag counts as yours, and
Jevonganize never removes it on its own. See [tags](tags.md#ai-provenance).

## Glossary

| Word | Meaning |
| --- | --- |
| Answer | One raw result from a model, stored before any threshold applies |
| Answer key | The hash that identifies a stored answer. See [storage](storage.md#answer-key) |
| Custom facet | A facet you wrote, in your config directory |
| Decision model | A model that answers typed questions with labels and probabilities |
| Estimated | An answer from a chat model rather than a native decision model |
| Extractor | One step that reads a file format. See [pipeline](pipeline.md) |
| Facet | One attribute of a file, as a definition |
| Fingerprint | `ino`, `size`, `mtimeNs` and `ctimeNs`. It tells a scan whether a file changed |
| FileState | What a model receives for one file: text, images and metadata |
| Home tag | What a file put in a virtual folder gets |
| Index | The local SQLite database. It mirrors tags and stores answers |
| Label | One allowed value of a facet |
| Library | A folder you asked Jevonganize to manage |
| Mirror | The copy of on-disk tags held in the index |
| Open facet | A facet that can gain new labels once a person accepts them |
| Pack | A group of up to 10 presets |
| Plan | A stored set of tag changes that a person can preview, apply and undo |
| Preset | A facet that ships with Jevonganize |
| Profile | A named extra model that a facet can use. See [providers](providers.md#profiles) |
| Provenance | Whether a tag was written from an AI answer. Stored in `file_tag.ai` |
| Provider | The service that runs the model |
| Review queue | Items waiting for a person: suggested tags and lost tags |
| State | The input sent to a model, in SDK terms. Built from FileState |
| Tag | One string on one file, on disk |
| Virtual folder | A saved rule over tags. Matching files collect in it; nothing on disk moves |
| Vocabulary | The accepted labels of an open facet |
