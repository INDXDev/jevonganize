# UI

The app follows the PC language by default. Settings > General > Language offers System default,
English, 日本語 and 简体中文, saved as the global `language` config. A save updates interface text,
accessibility labels and formatting without restarting or discarding the current view. The browser
and Electron use the same catalogs and the server's detected PC language. User content and tag
identifiers keep their original text. See [Interface language](configuration.md#interface-language).

CI config runs browser E2E, including saved-language switching and PC-language selection, on macOS,
Linux and Windows. The Electron smoke test runs on macOS; this does not verify packaged Linux or
Windows desktop apps.

The UI is one React app, built to `dist/web/` and served by the local server. The browser and the
desktop window load the same pages. It follows the system's light or dark appearance, and a person
can pin either one. Everything the CLI does can be done here, see
[CLI and UI parity](#cli-and-ui-parity).

`web/` imports only types from outside itself and talks to the server over HTTP, through
[`call()`](contracts.md#http), `/api/events`, `/api/chat`, `/thumb/:id` and `/file/:id`.

## Design system

The look borrows ideas from Warp and Cursor: blocks, one overlay surface, an agent in a side pane,
dense neutral chrome. **The tokens below are original proposals in that style. They are not Warp's
or Cursor's real values.** No official Cursor colours were found, and Warp's UI was not sampled.

`src/web/tokens.css` holds them. Sizes are written in `px` for clarity and ship as `rem`, so browser
zoom works.

Colours are written `light-dark(light, dark)`, so each token is defined once, with both values side
by side.

```css
:root {
  color-scheme: light dark;   /* follows the OS */

  /* surfaces. Dark: darkest at the back. Light: panes white on a grey window */
  --bg: light-dark(#f3f4f6, #0e0f11);          /* window */
  --surface-1: light-dark(#ffffff, #141518);   /* panes */
  --surface-2: light-dark(#f1f2f4, #1b1d21);   /* cards, inputs, hover */
  --surface-3: light-dark(#e4e6ea, #24262b);   /* selected */
  --overlay: light-dark(#ffffff, #24262b);     /* dialogs, menus */

  /* borders */
  --border: light-dark(rgb(0 0 0 / 0.09), rgb(255 255 255 / 0.08));         /* decorative hairline */
  --border-strong: light-dark(rgb(0 0 0 / 0.16), rgb(255 255 255 / 0.14));  /* pane dividers */
  --border-control: light-dark(#7e828b, #71757e);                           /* inputs: >= 3:1 */

  /* text */
  --text: light-dark(#1b1c1f, #ededef);
  --text-2: light-dark(#4d5159, #a8abb3);
  --text-3: light-dark(#5e626b, #8b8f98);

  /* one accent; status colours only for status */
  --accent: light-dark(#2a5bd0, #7aa7ff);
  --accent-soft: light-dark(rgb(42 91 208 / 0.12), rgb(122 167 255 / 0.16));
  --on-accent: light-dark(#ffffff, #0e0f11);
  --ok: light-dark(#177245, #5fcf8e);
  --warn: light-dark(#8a5a00, #e6b450);
  --err: light-dark(#c02b2b, #f2777a);
  --focus: var(--accent);

  /* type: 13px base, as in desktop tools */
  --font-ui: 'Inter Variable', system-ui, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --text-xs: 11px;  --text-sm: 12px;  --text-md: 13px;
  --text-lg: 14px;  --text-xl: 16px;  --text-2xl: 20px;

  /* density */
  --space: 4px;
  --row: 28px;       /* list rows, sidebar */
  --row-dense: 24px;
  --control: 28px;   /* inputs, buttons */
  --titlebar: 38px;
  --tile: 160px;     /* grid minimum */

  /* shape */
  --radius-sm: 4px;  --radius-md: 6px;  --radius-lg: 10px;
  --shadow-overlay: 0 12px 32px light-dark(rgb(0 0 0 / 0.16), rgb(0 0 0 / 0.5));

  /* motion: fast, and never on the list itself */
  --dur-fast: 80ms;  --dur: 120ms;  --dur-slow: 180ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
@media (prefers-contrast: more) {
  :root {
    --border: light-dark(rgb(0 0 0 / 0.35), rgb(255 255 255 / 0.3));
    --text-2: light-dark(#33363c, #d0d2d8);
    --text-3: light-dark(#44474e, #b8bbc2);
  }
}
:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
```

Bind them to shadcn and Tailwind once, so copied components inherit them:

```css
@theme inline {
  --color-background: var(--bg);
  --color-card: var(--surface-1);
  --color-popover: var(--overlay);
  --color-muted: var(--surface-2);
  --color-foreground: var(--text);
  --color-muted-foreground: var(--text-2);
  --color-primary: var(--accent);
  --color-primary-foreground: var(--on-accent);
  --color-border: var(--border);
  --color-ring: var(--focus);
  --color-destructive: var(--err);
}
```

### Theme

`useWindow.theme` is `system` (the default), `light` or `dark`. It is kept in `localStorage`, per
window, and is not config. It lands on `<html data-theme>`, where `light` and `dark` set
`color-scheme` and `system` sets nothing, so the OS decides and changes apply live. No component
branches on the theme: they only use tokens.

Three controls set it: the button at the right of the title bar, which cycles through the three,
Settings > Appearance, and the palette. The native title bar on Windows and Linux follows the OS, as
the window has no IPC to be told otherwise. The frame around a Word preview takes the current colours
when it opens.

Rules:

- Overlays use `--overlay`, a `--border-strong` outline and `--shadow-overlay`. Nothing else casts
  a shadow.
- Accent marks focus, selection and the primary action only. Chrome stays neutral.
- Lists do not animate. Panels and overlays may, within `--dur-slow`.
- Never use colour alone. Tags have names, and status has an icon.
- No web fonts from the network. The CSP forbids them.

## The shell

Every view sits in the same frame: title bar with tabs, a rail of screens, a content area of
[panes](#component-rules), and a status bar.

```text
┌ ● ● ●  [Docs] [Invoices ×] [+]                  ⌘K Search…  ☀ ────┐
├──────┬────────────────────────────────────────────────────────────┤
│ Files│                                                            │
│ Orgz │                                                            │
│ Revw │                         view panes                         │
│ Tags │                                                            │
│ Fcts │                                                            │
│ Actv │                                                            │
│ Sets │                                                            │
├──────┴────────────────────────────────────────────────────────────┤
│ 12,402 files · 1 selected   ⟳ organize ▓▓▓░ 80%  Review 38  ⌘I Chat│
└───────────────────────────────────────────────────────────────────┘
```

The rail shows every screen, from `SCREENS` in `view-query.ts`, which also gives the `g` shortcuts and
tab titles. Review carries a count. Switching screen keeps the rest of the query, so the filter set
in Files is the scope in Organize.

The status bar shows the file count, the selection, pending reviews (from the `reviews` event), the
running job with a progress bar (from the `job` event) and the chat toggle. Clicking the job opens the
activity screen. While a job runs, `status` is also polled every three seconds, so an end that was
missed during a reconnect still shows. A job's end is announced in the status bar.

On `files` events, React Query invalidates the affected queries. It does not refetch every page. A
write from the UI refreshes only the reads listed for it in `web/refresh.ts`, and everything if it is
not listed. A list page is fetched once it has stayed on screen for 120 ms, and leaving it cancels
the request.

## Tabs

```ts
type Tab = { id: string; title: string; query: string };
// zustand + persist: { tabs: Tab[], activeId: string }
```

- `query` is a URL query string, and it is the whole state of the view. There is no other tab model.
- Only the active tab is mounted. React Query's cache makes switching instant.
- `title` follows the query: the screen name, else the first tag, else the last folder segment.
- The address bar shows the active tab's query, so a link restores a view.
- No drag to reorder, no split tabs and no tab groups in v1. No router library.

`localStorage` is per origin, so tabs, pane sizes and appearance survive a restart while the port
stays the same. The server uses `port` from config unless that port is taken.

### The view query

| Param | Values | Meaning |
| --- | --- | --- |
| `screen` | `browse` (default), `organize`, `review`, `tags`, `facets`, `activity`, `settings` | Which view |
| `folder`, `text`, `mime`, `status`, `sort`, `order` | As in `FileQuery` | Passed through unchanged |
| `tag` | Repeatable | `FileQuery.tags`. On `review`, the open group |
| `match` | `any` (default), `all` | `FileQuery.tag_match` |
| `not` | Repeatable | `FileQuery.exclude_tags` |
| `view` | `grid` (default), `list` | Layout of the file list |
| `file` | File id | The file in the inspector |
| `facet` | Facet id | The facet open in the editor, or the facet filter on `tags` |
| `section` | Section id | The section on `settings` or `review`, or the plan status on `activity` |

The selection, the open panes and the chat are not view state, so they are not in the query. They
belong to the window. `limit` and `offset` are not in it either: the virtual list sets them.

## Onboarding

Shown when `status` reports no libraries. One screen with steps that open in order. Nothing is sent or
written until "Choose for me" or "Organize". "Organize" adds the chosen topics, or runs `pick_topics` for 100 if
none were chosen, organizes and applies, and reads proper names and applies them, with no approval. Each plan can be undone.

```text
┌───────────────────────────────────────────────────────────────────┐
│                           Jevonganize                             │
│                                                                   │
│  1 OpenAI key       ┌──────────────────────────┐  Get a key ↗     │
│                     │ ••••••••••••••••         │                  │
│                     └──────────────────────────┘                  │
│  2 Folder           ┌──────────────────────────┐                  │
│                     │ ~/Documents       Browse │  412 files found │
│                     └──────────────────────────┘                  │
│  3 Packs            ☑ Core  ☑ Time  ☑ Sensitivity  ☑ Media  more… │
│                                                                   │
│  4 Topics                                                         │
│    [ Search topic catalog        ]  [ Choose for me ]             │
│    finance  work  legal  health  travel  housing  family  hobbies │
│                                                                   │
│  5 Before you start                                               │
│    Sent to OpenAI for each file: its name, up to 8,000 characters │
│    of text, up to 2 images, and metadata. Nothing else.           │
│    First 200 files · 9 facets · 0.7M tokens · about $0.07         │
│    ☐ All 412 files, about $0.14                                   │
│                                                                   │
│                         [ Organize ↵ ]         Skip for now       │
└───────────────────────────────────────────────────────────────────┘
```

| Step | Tools | Notes |
| --- | --- | --- |
| Key | `set_api_key`, `list_keys`, `set_env_keys` | With `OPENAI_API_KEY` set, a button uses it, and that click is the consent. The key field is `type=password`. It is never shown again. A rejected key shows up on the first model call, and the job stops at step 5 with the provider's message |
| Folder | `browse_dirs`, `add_library`, `scan` | The picker works like a Finder list: places, back and forward, a path bar, sorting by name, date or size, a filter and hidden items. Double-click or Right enters a folder. Files show dimmed, and links are never entered. A folder on a volume with `taggable: false` shows a warning and cannot be used. See [troubleshooting.md](troubleshooting.md#volume-unsupported) |
| Packs | `list_facets`, `set_enabled` | Defaults come from `facets.enabled` |
| Topics | `search_catalog`, `pick_topics`, `set_vocabulary` | Searching is local and free. A domain chip fills the search. "Choose for me" sends file names and shows the 100 picks here, each removable. Nothing joins `topic` until Organize. With nothing chosen, Organize chooses first |
| Cost | `estimate` | The notice names the real provider and model, and takes its numbers from `[budget]`. `cost_usd: null` shows "cost unknown" |
| Organize | `organize` | Limit 200 by default, so a first run ends quickly. Progress shows as a [block](#blocks) |
| Apply | `apply_plan` | Applies the plan, and opens [Names](#names) with what the run found |

"Skip for now" opens the browser. Scan and search work with no key. Organize refuses, as anywhere.

## Browser

```text
┌ ● ● ●  [Docs] [Invoices ×] [+]                     ⌘K Search… ────┐
├─────────────┬───────────────────────────────────┬─────────────────┤
│ LIBRARIES   │ ~/Docs › 2026 › Invoices  ▦ ☰  ⇅  │ invoice-44.pdf  │
│ ▸ All  12k  ├───────────────────────────────────┤ ┌─────────────┐ │
│ ▸ Docs  9k  │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │ │   preview   │ │
│ ▸ Photos 3k │ │     │ │     │ │▓▓▓▓▓│ │     │   │ └─────────────┘ │
│ DOC-TYPE    │ └─────┘ └─────┘ └─────┘ └─────┘   │ PDF · 212 KB    │
│ ☑ invoice   │ a.pdf   b.pdf   c.pdf   d.png     │ 2026-03-02      │
│ ☐ receipt   │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │ TAGS          + │
│ TOPIC       │ │     │ │     │ │     │ │     │   │ [doc-type:inv×] │
│ ☐ finance   │ └─────┘ └─────┘ └─────┘ └─────┘   │ [doc-date:2026] │
│ TYPE        │                                   │ SIMILAR         │
│ ◦ PDF       │                                   │ ▫ inv-43   0.94 │
│ ◦ Image     │                                   │ ▫ inv-41   0.91 │
├─────────────┴───────────────────────────────────┴─────────────────┤
│ 12,402 files · 1 selected   Review 38   ⟳ Scanning 80%   ⌘I Chat  │
└───────────────────────────────────────────────────────────────────┘
```

**Sidebar.**

- Libraries come from `list_libraries`. Each row shows the file count, and sets `folder`.
- Tags come from `list_tags`, grouped by `facet`, with plain tags last under "Other". Counts cover
  the current folder, not the other filters.
- Click a tag to add it to `tag`. `Alt`+click adds it to `not`. Child tags match, as `FileQuery.tags`
  says. Files with **any** of the chosen tags show.
- Type is a fixed list that sets `mime`: PDF, Images (`image/*`), Audio, Video, Text. It has no
  counts, as no tool gives them.
- Status sets `status`: New, Organized, Failed.

**Filter bar.** The chosen tags sit above the list, joined by the word "or". With two or more, an
`Any tag | All tags` switch appears beside them. Choosing All tags sets `match=all`, and the word
becomes "and". `m` does the same. Excluded tags are always left out, whichever is chosen. The toolbar
holds Scan, which updates the library this folder is in, and Organize, which opens that screen.

**File list.** Rows come from `search_files`. Grid and list are the same [`FileList`](#component-rules).
Sorting happens in SQLite, never in the browser, by name, kind, date or size. A list row shows at most
three tag chips, then `+N`. A double click opens the file in its default app, unless it is [an executable](security.md#opening-a-file). `Space` is the quick preview.

**Subfolders.** With a folder open, the folders directly under it sit above the list, from
`list_folders`. Clicking one goes in, and the path above the list goes back up.

**View options.** The sliders button, or `Mod+J`, changes the [`[view]`](configuration.md#view) config:
tiles per row, thumbnail size, spacing, whole or cropped thumbnails, the line under a name, list
columns, text size, dotfiles, subfolders and extensions. A slider redraws as it moves and saves when it
is let go. What a view hides, Organize and chat leave out too.
A file on a volume that cannot store tags shows no tag actions anywhere.

**Inspector.** Opens when a file is clicked, and sets `file`. It calls `get_file` and `similar_files`.

| Section | Content |
| --- | --- |
| Preview | See [File previews](#file-previews) |
| Facts | Kind, size, modified, path with a Reveal action (`reveal_file`). The header has Open (`open_file`) and Reveal |
| Tags | Every tag as a chip. `+` adds and `×` removes, through `propose_changes` and `apply_plan`. A single-file change applies at once, because the person made it directly. The spark calls `suggest_tags`, which sends this file to the provider, and its results appear under Pending |
| Pending | The file's `reviews`, with accept and reject |
| Metadata | `metadata` as a key and value table, collapsed |
| Answers | `answers`: facet, value, confidence, and `estimated` as a label. Collapsed |
| Similar files | `similar_files`, ordered best first by `score`. Each row shows name, score to two decimals and shared tags. A click moves the inspector to that file. More asks for four times as many |

With several files selected, the inspector shows the count and the tags they share. `t` tags them all
and `Shift+T` removes a tag from them all. That change is a plan, shown as a block, and needs Apply. With nothing selected, it shows folder
counts.

A "Select all" acts on the query, not on ids. It sends `query` to `propose_changes`, so it works
across files that were never loaded.

## Names

`screen=names`, key `n`. Proper names, apart from other tags. It lists `entity` tags in scope and the
active values of `entity`, by count, with a kind filter and a text filter.

| Control | Tool | Effect |
| --- | --- | --- |
| Add | `set_vocabulary` | Registers a name. Each organize then asks about it for every file |
| Pin | `set_vocabulary` | Registers a name found in a file, or unregisters one |
| Show files | | Opens the files in a new tab |
| Rename | `rename_tag`, `apply_plan` | Renames or merges a name |
| Remove | `propose_changes`, `apply_plan`, `set_vocabulary` | Takes it off its files and retires it, so it is not offered again. Undo restores the tags |

There is no run of its own. Names come from `organize`.

## Organize

`screen=organize`. The screen for `jevonganize organize`, with its flags as controls. Its scope is the
tab's own query, so filters set in Files carry over, and nothing is sent until Organize is pressed.

```text
┌ Organize ──────────────────────────┬ Run ─────────────────────────┐
│ Folder [~/Documents     ▾]  [Scan] │ ┌ ⟳ Organizing 62% ─ running ┐│
│ [topic:law ×] or [topic:tax ×]     │ │ ▓▓▓▓▓▓▓▓▓▓░░░░░░           ││
│ Limit  [ All ]                     │ │ 256 of 412 · 870k tokens · ││
│ Facets                             │ │ about $0.09 · 40s left     ││
│  ▸ ☑ core        4/4               │ │ ~/Documents/a.pdf  [Cancel]││
│  ▸ ☐ finance     0/12              │ └────────────────────────────┘│
│ BEFORE YOU START                   │                               │
│ Sent to openai for each file: ...  │                               │
│ 412 files · 38 cached · 9 facets   │                               │
├────────────────────────────────────┤                               │
│ ◯ Apply when ready  [Organize 412] │                               │
└────────────────────────────────────┴───────────────────────────────┘
```

Under Facets, **Topics** lists the active values of `topic`. Adding one from the catalog activates it,
removing one retires it, and "Choose for me" runs `pick_topics`. Proper names need no control here:
every run reads them. See [Names](#names).

| CLI | Control | Tool |
| --- | --- | --- |
| `<path>`, query flags | Folder and the [filter bar](#browser) | `FileQuery` |
| `--limit` | Limit | `FileQuery.limit` |
| `--facets` | Facets. Ticks start on the enabled facets and hold for this run only | `facets` |
| `--dry-run` | Always on: the estimate updates as the controls change | `estimate` |
| `--no-apply` | Apply when ready, on by default | `apply_plan`, once the job ends |
| Ctrl-C | Cancel on the block | `cancel_job` |

- The numbers in the notice come from `[budget]` and `send_images`. Onboarding uses the same
  `SendNotice`.
- With no key the button is disabled and links to Settings > Keys, as organize would refuse.
- Run shows each running job. Once it ends, it shows the result, the plan as a block with Apply, and a
  link to any new review items.
- Apply when ready is remembered by the window that started the run, so a reload before the end
  leaves the plan waiting. It never applies a run where every file failed. Items in the review band
  stay in the queue.

## Tags

`screen=tags`. Every tag with its count, from `list_tags`, narrowed by the tab's folder, the `facet`
param and a text filter. Up to 500 rows show.

| Action | Tools |
| --- | --- |
| Show files | Opens a new tab filtered by the tag |
| Rename or merge | `rename_tag`. The plan appears in Changes, with Apply |
| Remove from every file | `propose_changes` with `query.tags`. The plan appears in Changes |
| Retire, Activate | `list_vocabulary`, `set_vocabulary`, for values of open facets |

## Review queue

Grouped by tag, so one decision can cover many files. `screen=review`.

```text
┌ Review · 38 pending ─────────────────────────── Sort: confidence ─┐
├──────────────────────┬───────────────────────────┬────────────────┤
│ PLANS WAITING 2      │ doc-type:invoice · 14     │ scan-0041.pdf  │
│ ┌ plan · mcp ──────┐ │ [Accept all ⇧A]           │ ┌────────────┐ │
│ │ +topic:tax on 61 │ │ ┌───────────────────────┐ │ │  preview   │ │
│ │ [Apply ⌘↵]       │ │ │▸ scan-0041.pdf   0.62 │ │ └────────────┘ │
│ └──────────────────┘ │ │  IMG_2231.jpg    0.66 │ │ Why: below the │
│ TAGS                 │ │  notes.docx      0.71 │ │ apply level    │
│ ▸ doc-type:invoice 14│ │  budget.xlsx     0.74 │ │ [A Accept]     │
│   topic:finance    9 │ └───────────────────────┘ │ [R Reject]     │
│   restore: 3         │                           │ [S Skip]       │
│ CLEANUP              │                           │                │
├──────────────────────┴───────────────────────────┴────────────────┤
│ 12 accepted · 2 rejected          j k move   [ ] group   ⇧A all   │
└───────────────────────────────────────────────────────────────────┘
```

- **Plans waiting.** Every plan from `list_plans` with status `proposed`, as blocks, newest first.
  Plans an agent proposed land here. See [llm-native.md](llm-native.md#approval-gate).
- **Tags.** `list_reviews` output is ordered by tag, then by confidence, highest first. Adjacent
  items with the same tag form a group. `kind: 'restore'` items have their own group at the end of the
  list, and show "This tag was on the file before it was saved".
- **Accept** calls `resolve_reviews`, then `apply_plan` on the plan it returns, because a person
  pressing the key is the approval. `Mod+Z` undoes it like any other plan.
- **Reject** calls `resolve_reviews` with `accept: false`. The item stays rejected, so a cached
  answer cannot bring it back.
- **Skip** moves to the next item and changes nothing.
- A `null` confidence shows as `n/a`, not as `0`.
- **Cleanup.** `cleanup_report` as a list: near-duplicates, one-file tags, over-broad tags. A
  near-duplicate row offers Merge, which calls `rename_tag` and shows the resulting plan.

## Facets editor

`screen=facets`. Packs on the left, the facet form in the middle, a sample result on the right. Above
the packs, a search box calls `search_catalog`, and clicking a result adds it to `topic`. The palette
offers "Choose topics for this folder" (`pick_topics`).

```text
┌ Facets ──────────────────────────────────────────────── [+ New] ──┐
├──────────────┬─────────────────────────────┬──────────────────────┤
│ ☑ Core       │ invoice-state     Finance   │ SAMPLE on 20 files   │
│ ☐ Finance    │ Title   Invoice state       │ About $0.01          │
│  ▸ invoice-… │ Kind    [ choice       ▾ ]  │ a.pdf  paid     0.97 │
│    amount    │ Question                    │ b.pdf  unpaid   0.91 │
│ ☑ Time       │ What is the payment state…  │ c.png  review   0.62 │
│ ☑ Media      │ Values                  [+] │                      │
│              │ paid    It shows the invo…  │ 18 of 20 above apply │
│              │ unpaid  It asks for paym…   │                      │
│              │ Applies to  application/*   │ [Run on sample]      │
├──────────────┴─────────────────────────────┴──────────────────────┤
│ Built-in. Saving creates your copy.     [Discard]  [Save ⌘S]      │
└───────────────────────────────────────────────────────────────────┘
```

The form shows only the fields for the chosen kind. Field names match `Facet`.

| Kind | Fields, besides `id`, `title`, `pack`, `applies_to`, `weight` |
| --- | --- |
| `flag` | `instructions`, `apply_above`, `profile` |
| `choice`, `multi` | `instructions`, `values`, `aliases`, `open`, `apply_above`, `profile` |
| `level` | `instructions`, `levels`, `aliases`, `apply_above`, `profile` |
| `date` | `instructions`, `precision`, `apply_above`, `profile` |
| `field` | `field`, `format` |

- A checkbox on a pack or facet calls `set_enabled`.
- Saving calls `save_facet`. A built-in facet is not edited in place. Saving writes a custom facet
  with the same id, which replaces it. `delete_facet` removes the copy and the built-in returns.
- Run on sample saves first, shows `estimate` for 20 files in the current folder, then calls
  `organize` with `limit: 20` and that facet. It spends money, and it stores a plan like any other.
- A change to anything the model sees changes `facetHash`, so answers for that facet are asked again.
  The bar says so. See [presets.md](presets.md).

## Settings

`screen=settings`. The form is generated from the JSON Schema that `get_config` returns, so a new
config key needs no UI code.

```text
┌ Settings ─────────────────────────────────────── ⌕ Filter… ───────┐
├──────────────┬────────────────────────────────────────────────────┤
│ ▸ General    │ THRESHOLDS                                         │
│   Provider   │ Apply                 [ 0.50 ]                     │
│   Chat       │   At or above: joins the plan                      │
│   Facets     │ Review                [ 0.50 ]                     │
│   Thresholds │ Estimated to review   [■]                          │
│   Budget     │                                                    │
│   Watch      │ BUDGET                                             │
│   ──────     │ Text chars            [ 8000 ]                     │
│   Keys       │                                                    │
│   Libraries  │                                                    │
│   Agents     │                                                    │
│   Appearance │                       [Discard]  [Save ⌘S]         │
└──────────────┴────────────────────────────────────────────────────┘
```

| Schema | Control |
| --- | --- |
| `object` | A section, with the key as its title. Top-level scalars go in General |
| `boolean` | Switch |
| `integer`, `number` | Number input, with the schema's minimum and maximum |
| `string` with `enum` | Select |
| `string` | Text input |
| `array` of strings | Chip input |
| `array` of objects, such as `pipeline`, and tables with free keys, such as `profiles` | JSON text, parsed as you type and validated by `set_config` on save. A profile cannot be deleted here, since `set_config` merges tables |
| `description` | Help text under the control |

Save sends the changed keys to `set_config`. A validation error comes back as `{ ok: false, error }`
and shows above the form. See [configuration.md](configuration.md).

Five sections do not come from the schema:

| Section | Content |
| --- | --- |
| Keys | One row per provider from `list_keys`, showing where its key comes from. Save calls `set_api_key` and Remove calls `remove_api_key`. A switch calls `set_env_keys`. A key is never shown |
| Libraries | `list_libraries`, `add_library` then `scan`, `scan` per row, `remove_library`. Removing clears the index only. Tags stay |
| Agents | The MCP command with a Copy button. See [llm-native.md](llm-native.md#connecting-a-client) |
| Appearance | [Theme](#theme), density and UI scale for every screen, kept in `localStorage`. They are per window and are not config. File list sizes are in the `[view]` config |
| Health | `doctor`, with Check again, and the paths from `get_config` |

## Chat panel

Docks on the right, and `Mod+I` toggles it. Full behaviour is in [llm-native.md](llm-native.md).

```text
┌ Chat ─────────────────────────────── ⌘I ┐
│ You                                     │
│ tag all 2026 scans from Acme as invoice │
│                                         │
│ ✓ search_files  214 matches             │
│ ┌ plan · +doc-type:invoice on 214 ────┐ │
│ │ 211 add · 3 already tagged          │ │
│ │ ▸ show changes                      │ │
│ │ [Apply ⌘↵]  [Copy as CLI]           │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Scope: Invoices tab · 12,402 files      │
│ ┌─────────────────────────────────────┐ │
│ │ Ask or describe a change…        ↵  │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

- Uses `useChat` against `POST /api/chat`. `Enter` sends, `Shift+Enter` adds a line.
- Each tool call shows as one collapsed line, which expands to a [block](#blocks).
- The scope is the active tab's `FileQuery`, sent as `metadata.scope` on each user message.
- History lives in memory for the window. Nothing about a chat is stored.
- With no key for `[chat]`, the input is disabled and links to Settings.

## Blocks

Every job and plan is a block: one atomic unit of what was asked, what happened, and what can be done
about it. This is the Warp idea. The same `Block` serves the activity screen, the review queue and
chat.

```text
┌ retag 214 files  ·  doc-type:invoice → doc-type:receipt ── 12:04 ✓ ┐
│ 214 changed · 3 skipped · 1.2s                                     │
│ ▸ show changes                              [Undo] [Copy as CLI]   │
└────────────────────────────────────────────────────────────────────┘
```

| State | Header icon | Body | Actions |
| --- | --- | --- | --- |
| Plan `proposed` | `○` | `summary`: file count, tags added and removed | Apply, Copy as CLI |
| Plan `applied` | `✓` | The same, plus any `errors` count | Undo, Copy as CLI |
| Plan `undone` | `↶` | The same | Copy as CLI |
| Plan `failed` | `✕` | `errors`, by file | Copy as CLI |
| Job running | `⟳` | Progress bar, percent, `done` of `total`, `tokens`, `cost_usd`, time left, `current`. A scan has no known total, so its bar only shows activity | Cancel (`cancel_job`) |
| Job `done` | `✓` | Counts, what a scan found, failures and `warnings`. An `organize` job links to its plan | |
| Job `failed`, `cancelled` | `✕` | `error` | |
| Chat tool call | `✓` | The tool's output, truncated | |

- "Show changes" expands the plan's `ops` in a `FileList`, loaded on demand.
- Apply is always `Mod+Enter` or a click. Plain `Enter` never applies.
- "Copy as CLI" copies the equivalent command, such as `jevonganize apply 7f3a9c21`. This teaches
  people and agents the CLI.
- `screen=activity` lists blocks from `list_plans` and the server's recent jobs, newest first. A
  status filter narrows it to plans of that status, like `plans --status`.
- Blocks use `summary`, so a plan of 100,000 ops renders without walking them.

## Command palette

`Mod+K` or `Mod+Shift+P`. It uses `cmdk` through shadcn `Command`.

One array in `src/web/commands.ts` is the single source for bindings, palette rows and shortcut hints:

```ts
type Command = { id: string; title: string; keys?: string; run: () => void; when?: () => boolean };
```

| Input | Scope |
| --- | --- |
| `>` | Commands |
| `#` | Tags, from `list_tags`. `Enter` opens a new tab filtered by the tag |
| `@` | Folders, from `list_libraries` |
| No prefix | Recent items, then commands, then files from `search_files` |

Opens on keydown, 560 px wide, in the top third of the window. Each row shows its shortcut. `Enter`
runs, `Mod+Enter` runs the secondary action, `Tab` opens a submenu of actions, and `Esc` closes and
returns focus.

## Keyboard map

`Mod` is `Cmd` on macOS and `Ctrl` elsewhere. Single-letter keys are ignored while focus is in an input.

Browsers reserve `Mod+T`, `Mod+W` and `Mod+1..9`, so **browser mode uses `Alt+T`, `Alt+W` and
`Alt+1..9`**. The desktop app uses `Mod`, and its short menu leaves those keys free. Which other
combinations each browser lets a page override was not verified.

| Scope | Keys | Action |
| --- | --- | --- |
| Global | `Mod+K`, `Mod+Shift+P` | Palette |
| | `Mod+T` / `Mod+W` | New tab / close tab |
| | `Mod+1..9` | Go to tab |
| | `Mod+B` | Toggle sidebar |
| | `Mod+.` | Toggle inspector |
| | `Mod+I` | Toggle chat |
| | `Mod+Z` | Undo the last applied plan |
| | `Mod+S` | Save the open form |
| | `?` | Shortcut sheet |
| | `g` then `b`, `o`, `r`, `t`, `f`, `a`, `s` | Go to files, organize, review, tags, facets, activity, settings |
| | `Esc` | Close the overlay, or clear the filter |
| File list | `j` `k` or arrows | Move |
| | `h` `l` or arrows | Move left and right in the grid |
| | `Space` | Quick preview |
| | `Enter` | Open in the inspector |
| | `Mod+Enter` | Reveal in the file manager |
| | `x` | Toggle selection |
| | `Mod+A` | Select all in the query |
| | `t` / `Shift+T` | Tag the selection / remove a tag from it |
| | `m` | Switch between any tag and all tags |
| | `/` | Focus the filter |
| | `v` | Switch grid and list |
| | `Mod+J` | View options |
| | `Mod+Shift+.` | Show or hide dotfiles |
| Review | `j` `k` | Next and previous item |
| | `[` `]` | Previous and next group |
| | `a` / `r` / `s` | Accept / reject / skip |
| | `Shift+A` / `Shift+R` | Accept / reject the whole group |
| Block | `Mod+Enter` | Apply the plan |
| | `Enter` | Show changes |
| Chat | `Enter` / `Shift+Enter` | Send / new line |

## Component rules

One component per idea. If a view needs a variant, add a prop. Do not add a second component.

| Component | Used by | Rule |
| --- | --- | --- |
| `FileList` | Browser, review groups, plan changes, similar files | The only way to show files. Props: rows or a `FileQuery`, `mode` (`grid`, `list`, `compact`), selection. It owns virtualisation, keyboard and ARIA |
| `TagChip` | Everywhere a tag appears | The only way to show a tag. Tinted in the tag's colour, from `tag_colors`: its own, else its facet's, else an automatic one from the facet name. Facet prefix in `--text-2`. Optional `count`, `confidence`, `onRemove`. Renders text through React, so a hostile tag stays text |
| `Block` | Activity, review, chat | The only way to show a job, plan or tool result |
| `Pane` | Every view | The only scroll container. It wraps a `Panel` from `react-resizable-panels` and owns title, actions, and empty, loading and error states |

Also:

- Copied shadcn primitives live in `components/ui/`. Views do not style them by hand.
- No view calls `fetch`. Everything goes through `call()`.
- Views hold no server data in zustand. That is React Query's job.
- Use the `react-resizable-panels` v4 API: `Group`, `Panel`, `Separator`. Numbers are pixels, strings
  are percent. Do not use its `Workspace` dock.

## File previews

`Preview` is one component, used by the inspector and the `Space` overlay. It chooses by `mime`.

| Kind | How | Limits |
| --- | --- | --- |
| Images, and any type below does not name | `<img src="/thumb/:id?size=1024">`, which also covers slides, sheets and mail. An `<img>` runs no script, even for SVG | If `thumbnail()` gives nothing, show metadata |
| PDF | `pdfjs-dist` on `/file/:id`, using range requests | Render visible pages only. Worker and library must be the same version |
| Word (`.docx`) | `mammoth` turns the bytes from `/file/:id` into HTML, shown in `<iframe sandbox="">` through `srcdoc` | Skip above `budget.max_parse_mb` |
| HTML | The bytes from `/file/:id` in `Frame`, an `<iframe sandbox="">` through `srcdoc`. `Page` and `Source` switch between it and the text view. See [security.md](security.md#serving-originals) | First 16 MiB, in the charset the page declares |
| Audio and video | The browser's own player on `/file/:id` | A type the browser cannot play shows metadata |
| Text and source code | First 256 KiB through a range request, as text in `<pre>` | Decoded as UTF-8, with a note if cut off |
| Anything else | Metadata only: `metadata`, extracted facts, and Reveal | |

- `pdfjs-dist` and `mammoth` load through dynamic `import()`, so they cost nothing until used.
- `FileRow` holds no thumbnail key, so thumbnail URLs add `&v=<mtime_ms>`. A changed file then gets a
  fresh URL under the immutable cache.
- The inspector's preview takes about half the window, and its button or `Space` opens a large one.
- Rendering rules for hostile content are in [security.md](security.md#serving-originals).

## 100k files

The grid and list are designed for 100,000 files. **This is a design, not a measurement.** Benchmark
with synthetic data before building on it.

- One `@tanstack/react-virtual` row virtualizer. `columns = floor(width / --tile)`, and each virtual
  row renders `columns` tiles. List mode uses the same virtualizer with `--row` height.
- Row heights are fixed. Rows never measure themselves.
- `search_files` gives `total`, which sets the virtual count. Pages of 500 load for the visible range,
  through `limit` and `offset`, and React Query keeps them.
- Sort and filter live in SQLite. Do not use TanStack Table.
- Thumbnails load lazily by URL and are generated on first view.
- Selection is a set of ids, or "all in query". Never expand "all" to ids in the browser.

## CLI and UI parity

Everything the CLI does has a place here. A new tool needs one too: `test/tools.test.ts` fails if a
tool's name does not appear in `web/`.

| CLI | UI |
| --- | --- |
| `setup` | [Onboarding](#onboarding) |
| `scan` | Scan in the browser toolbar, on Organize and in Settings > Libraries |
| `organize` | [Organize](#organize) |
| `plans`, `apply`, `undo` | Activity, with its status filter, and the plan [block](#blocks) |
| `tags list`, `tags rename` | [Tags](#tags) |
| `tags add`, `tags remove` | `t` and `Shift+T` on a selection, and the inspector. Tags can remove a tag everywhere |
| `search`, `show`, `similar` | [Browser](#browser) and inspector |
| `review`, `cleanup` | [Review queue](#review-queue) |
| `suggest` | The spark in the inspector's Tags section |
| `facets` | [Facets editor](#facets-editor) |
| `config get`, `config set`, `config edit` | [Settings](#settings) |
| `config path`, `doctor` | Settings > Health |
| `auth` | Settings > Keys |
| `ask` | [Chat panel](#chat-panel) |
| `mcp` | Settings > Agents shows how to connect a client. The client starts the server |

## Accessibility

| Area | Rule |
| --- | --- |
| Contrast | In both themes, all text passes 4.5:1 on all four surfaces. The tightest dark pair is `--text-3` on `--surface-3`, at 4.67, and the tightest light one is `--err` on `--surface-3`, at 4.64. `--accent`, `--ok`, `--warn`, `--err` and `--border-control` pass 3:1 on all surfaces, computed with the WCAG formula. `--border` is decorative. Anything a user must see uses `--border-control` |
| Focus | 2 px solid outline. Overlays return focus when they close |
| Virtual grid | `role="grid"`, roving `tabindex`, `aria-rowcount` and `aria-rowindex`, because most rows are not in the DOM |
| Live updates | The end of a job goes through one polite `aria-live` region. Bars are native `<progress>` |
| Status | Every status has an icon and text, never colour alone |
| Motion | `prefers-reduced-motion` is handled globally |
| Contrast setting | `prefers-contrast: more` raises borders and secondary text |
| Zoom | Sizes ship as `rem` |
| Keyboard | Every action works from the keyboard, and every command is in the palette |

## Source layout

```text
src/web/
├── main.tsx            Mounts the app, React Query, zustand
├── app.tsx             Shell: tabs, panes, status bar, overlays
├── api.ts              call(), the events hook
├── tabs.ts             The tab store
├── view-query.ts       URL query to and from view state and FileQuery
├── commands.ts         The one command array
├── tokens.css          Tokens and the Tailwind binding
├── components/
│   ├── ui/             Copied shadcn primitives
│   ├── file-list.tsx   The list, with its state in file-list-state.ts
│   ├── file-row.tsx    A tile, a line and the column heads
│   ├── file-icon.tsx
│   ├── tag-chip.tsx
│   ├── block.tsx
│   ├── pane.tsx
│   ├── filters.tsx     The tab's filters and the any/all switch
│   ├── send-notice.tsx What a run sends and costs
│   ├── palette.tsx
│   ├── folder-picker.tsx
│   └── preview/        index.tsx, pdf.tsx, word.tsx, text.tsx
└── views/
    ├── onboarding.tsx  State, with the steps in onboarding-steps.tsx
    ├── browse.tsx      Panes, with browse-sidebar.tsx, browse-toolbar.tsx, browse-dialogs.tsx
    ├── inspector.tsx   Selection and folders, with the file in inspector-file.tsx
    ├── organize.tsx
    ├── review.tsx
    ├── tags.tsx
    ├── facets.tsx      The list, with the editor in facets-form.tsx
    ├── settings.tsx    The shell, with settings-form.tsx and settings-sections.tsx
    ├── activity.tsx
    └── chat.tsx
```
