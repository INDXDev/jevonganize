# UI

The app follows the PC language by default. Settings > Language and help > Language offers System default,
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
│ Fldrs│                                                            │
│ Tags │                         view panes                         │
│ Dash │                                                            │
│ Qstns│                                                            │
│      │                                                            │
│ Sets │                                                            │
├──────┴────────────────────────────────────────────────────────────┤
│ 12,402 files · 1 selected   ⟳ organize ▓▓▓░ 80%  Review 38  ⌘I Chat│
└───────────────────────────────────────────────────────────────────┘
```

The rail shows every screen, from `SCREENS` in `screens.ts`, which also gives the `g` shortcuts and
tab titles. Each rail button carries `data-tour="screen-<id>"`. Switching screen keeps the rest of the
query, so the filter set in Files is the scope of Organize.

| Screen | Name (en / ja) | Key | Content |
| --- | --- | --- | --- |
| `browse` | Files / ファイル | `g b` | The [browser](#browser) |
| `folders` | Folders / 仮想フォルダー | `g v` | [Folders](#folders): the virtual folder tree, suggestions, and the open folder's rule above its files |
| `tags` | Tags / タグ | `g t` | [Tags](#tags): the tag tree, with the sections [Review](#review-queue) and [Names](#names), and [Organize](#organize) as a drawer. Carries the count of pending reviews, shown as `99+` above 99 |
| `dashboard` | Dashboard / ダッシュボード | `g d` | The [Dashboard](#dashboard): usage and cost, the state of the index, and the history of jobs and plans |
| `facets` | Questions / 分類項目 | `g f` | The [facets editor](#facets-editor): the questions asked about each file, and their labels |
| `settings` | Settings / 設定 | `g s` | [Settings](#settings), at the bottom of the rail |

Organize, Review, Names and Activity were screens of their own. Their old addresses still open, as
the [view query](#the-view-query) describes, and their old keys still work for one release.

The status bar shows the file count, the selection, pending reviews (from the `reviews` event), the
running job with a progress bar (from the `job` event) and the chat toggle. Clicking the job opens the
dashboard's history, and clicking the review count opens Tags at Review. While a job runs, `status` is also polled every three seconds, so an end that was
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
| `screen` | `browse` (default), `folders`, `tags`, `dashboard`, `facets`, `settings` | Which view. Old values are read as their new place: `organize`, `review` and `names` as `tags` with that `section`, and `activity` as `dashboard` with `section=history`. Only the new form is written |
| `folder`, `text`, `mime`, `status`, `sort`, `order` | As in `FileQuery` | Passed through unchanged |
| `tag` | Repeatable | `FileQuery.tags`. On `tags`, the selected tag, which is also the open group in the Review section |
| `match` | `any` (default), `all` | `FileQuery.tag_match` |
| `not` | Repeatable | `FileQuery.exclude_tags` |
| `view` | `grid` (default), `list` | Layout of the file list |
| `file` | File id | The file in the inspector |
| `facet` | Facet id | The facet open in the editor, or the facet filter on `tags` |
| `section` | Section id | The page on `settings`. On `tags`: `review` or `names`, else the tree, with the Organize drawer open for `organize`. On `dashboard`: `history`, from the old Activity screen, which the history pane always shows |
| `vfolder` | A saved folder's id, or a generated folder's key | The open [virtual folder](#folders), on `folders`. A `vfolder` on `browse`, from an old link, opens `folders`. Its rule is ANDed with the other filters, on Folders, Organize and chat |
| `vname` | Text | That folder's name, for the tab title |
| `newfolder` | A tag | On `folders`, opens the New folder dialog with that tag in its rule, then leaves the address. Written by Make a folder in a tag's detail pane |
| `period` | `7`, `30` (default), `90` | The days the Dashboard's usage covers, ending today |
| `plans` | `proposed`, `applied`, `undone`, `failed` | The plan status the Dashboard's history shows. Left out, it shows every plan and the jobs |

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
| Cost | `estimate` | The notice names the real provider and model, and takes its numbers from `[budget]`. `cost_usd: null` shows "cost unknown". It counts input tokens only: output is not included |
| Organize | `organize` | Limit 200 by default, so a first run ends quickly. Progress shows as a [block](#blocks) |
| Apply | `apply_plan` | Applies the plan, and opens Tags at [Names](#names) with what the run found |

"Skip for now" opens the browser. Scan and search work with no key. Organize refuses, as anywhere.

## Guided tour

After onboarding, by either way out, a tour starts once per viewer. Its first card, in the middle of
the window, offers **Show me around** or **Not now**. Each later card sits beside the element it
explains, which gets a highlight ring, and the tour goes to that element's screen first. It walks
down the rail: Files, Folders, Tags, Dashboard, Questions and Settings.

| Step | Target (`data-tour`) | Screen |
| --- | --- | --- |
| Welcome | None | Any |
| Your folders | `library` | Files |
| Favorites | `favorites` (the sidebar section) | Files |
| Scan | `scan` | Files |
| Organize | `organize` | Files |
| Folders | `vfolders` (the tree pane) | Folders |
| Tags | `screen-tags` (the rail) | Tags |
| Review | `tags-section-review` (the section button) | Tags |
| A tag's actions | `tag-detail` (the detail pane, there with or without a selected tag) | Tags |
| Dashboard | `screen-dashboard` (the rail) | Dashboard |
| Questions | `screen-facets` (the rail) | Questions |
| Settings | `screen-settings` (the rail) | Any |

- A step whose target does not appear within about a second is skipped, in the direction of travel. A
  feature adds a step by giving its element a `data-tour` id and a row in `STEPS` in `web/tour.ts`.
- Not modal: the app stays usable, and the highlight does not take clicks. The card is a non-modal
  `<dialog>` named by its title and described by its text. Focus moves to its main button on each
  step and returns where it was when the tour closes. Right and Left arrows move, `Esc` closes, and
  the step count is announced politely.
- Next, Previous, Skip tour and a close button. The last step's button is Done.
- Finishing or skipping saves `seen` in `localStorage` (`jev-tour`), like the window's other
  preferences. No config key or server route is involved.
- Start it again from Settings > Language and help, or the palette's "Start the tour".

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
- Favorites, marked `data-tour="favorites"`, are the starred tags from `list_favorite_tags`, in the
  order the person chose. Each row shows the tag's colour, its whole name and how many files carry
  exactly that tag, which can be 0. A click filters the tab to that one tag, and `Alt`+click excludes
  it. Files dragged from the list onto a row become a plan, `propose_changes` with `add`, that opens
  as a [block](#blocks), and nothing is written until Apply. Dragging a row onto another, or `Alt+↑`
  and `Alt+↓` on it, moves it, through `set_favorite_tag` with `position`. With none, the section says
  "Press ☆ on a tag to pin it here".
- The star (☆) stars a tag or takes it off, with `set_favorite_tag`. It sits on the tag chips of the
  inspector's Tags section and on the rows of the [tag tree](#the-tag-tree), shown on hover until the
  tag is starred, and in a tag's [detail pane](#the-detail-pane). The palette offers "Add to
  favorites" for each tag of the tab's filter. Starring writes no tag to any file. A favorite follows
  a rename or move of its tag once that plan is applied.
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
holds Scan, which updates the library this folder is in, and Organize, which opens the
[Organize](#organize) drawer on Tags.

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
| Tags | Every tag as a chip, with the [favorite star](#browser). `+` adds and `×` removes, through `propose_changes` and `apply_plan`. A single-file change applies at once, because the person made it directly. The spark calls `suggest_tags`, which sends this file to the provider, and its results appear under Pending |
| Pending | The file's `reviews`, with accept and reject |
| Metadata | `metadata` as a key and value table, collapsed |
| Answers | `answers`: facet, value, confidence, and `estimated` as a label. Collapsed |
| Similar files | `similar_files`, ordered best first by `score`. Each row shows name, score to two decimals and shared tags. A click moves the inspector to that file. More asks for four times as many |

With several files selected, the inspector shows the count and the tags they share, with "Make a folder from these files", which opens [New folder](#folders) on those tags. `t` tags them all
and `Shift+T` removes a tag from them all. That change is a plan, shown as a block, and needs Apply. With nothing selected, it shows folder
counts.

A "Select all" acts on the query, not on ids. It sends `query` to `propose_changes`, so it works
across files that were never loaded.

## Folders

```text
┌ Folders (virtual)  + ┬ ♥ Taxes  filter  ⟳ Scan  ✦ Organize ──┬ Inspector ┐
│ ▸ Taxes         128  │ [topic:finance ×] and [year:2024 ×] +  │           │
│   └ Travel       12  │   ⊘[status:draft ×]   128 files   ✎ ×  │           │
│ ▸ Contracts      45  ├─────────────────────────────────────────┤           │
│ SUGGESTIONS          │  file list (FileList)                   │           │
│ ⊕ tax            88  │                                         │           │
│ ⊕ acme × 2024    40  │                                         │           │
│ ▸ Auto: one folder per tag                                     │           │
└──────────────────────┴─────────────────────────────────────────┴───────────┘
```

Virtual folders have a screen of their own, `screen=folders`, with the open folder in `vfolder`. The
browser shows none of them. The panes are the same as the browser's: the tree hides with the sidebar
toggle, and the inspector is the browser's.

**Tree.** The left pane, marked `data-tour="vfolders"`, holds three parts:

- The saved tree from `list_vfolders`, with each folder's file count. Clicking a folder sets
  `vfolder`, and clears `folder` and the tag filters, so the list shows exactly the folder's files,
  through `search_files` with the query `vfolder_files` returns. Hovering a saved folder offers a
  folder inside it and Edit, where Delete also lives (`save_vfolder`, `delete_vfolder`). Deleting
  changes no file.
- Suggestions from `suggest_vfolders`: folders worth saving, from large tags, tags that go together
  and the parents of hierarchical tags. One click saves the suggestion as it is and opens it.
- Auto, which loads the generated folders only when opened: one per tag namespace, with its values
  nested by `/`. Each has a pin, which saves it as a folder of its own.

Files dragged from the list onto a saved folder with a home tag become a plan, `add_to_vfolder`. It
opens as a [block](#blocks), and nothing is written until Apply. A folder with no home tag takes no
drop.

**Rule bar.** Above the list, the open folder's rule as chips, joined by "and" or "or": `×` takes a
tag out, `+` opens a tag search that adds one, and excluded tags have their own `×`. Each change saves
the folder at once with `save_vfolder`, and the list and count refresh. A home tag that came only from
the rule's single tag is worked out again from the new rule. The bar also counts the folder's files,
offers Remove from folder (`remove_from_vfolder`) for the selection or the open file when the folder
has a home tag, Edit, and close. A generated folder shows its tag, read only. The title row keeps the
browser's text filter, Scan, Organize, sorting and view switches, and the tab's other filters sit
under the rule.

**No folder open.** With no saved folder at all, the middle shows the top six suggestions as cards,
each with its rule and count, and one click makes and opens it. With folders, it points to the tree.

**New folder.** `+` in the tree's title, a folder's "new folder inside", Edit, and "Make a folder from
these files" in the inspector of a selection all open one dialog: name, rule, the folder it goes
inside, and an optional home tag.

- Tags and Without are comboboxes. Typing offers existing tags from `list_tags`, those that start
  with the text, in the tag or its value, before those that contain it, each with its file count.
  `Enter` or a click takes the highlighted one, which starts on the best match. Text that is no tag
  yet can be taken too, and shows 0 files. `Backspace` in an empty field takes back the last tag.
- Under the tags, chips from `suggest_vfolder_tags` offer tags for the rule as it stands, each with
  how many of the rule's files carry it. A click adds it.
- The top right counts the files the rule matches, from the same call. At 0, a warning sits beside
  Save, which still works. The call waits until the rule has not changed for 150 ms.
- Until the name is typed, a new folder takes its name from its first tag's value: `topic:finance/tax`
  names it `finance / tax`.
- A new folder starts from the tab's tag filters, or from the tags every selected file shares. Its
  match is All unless the tab already had two or more tags, so suggested tags narrow it.
- Saving a new folder opens it.

## Tags

`screen=tags`. One screen for everything about tags: the hierarchy, the review queue, proper names
and the organize run, which were four screens before. The rail's Tags button carries the count of
pending reviews, shown as `99+` above 99.

```text
┌ TAGS [All tags] [Review 12] [Names] [topic] [party]   [Filter…] [✦ Run organize] ┐
├ Tags 412 ─────────────────────────┬ topic › finance › tax ────────────────────────┤
│ ▾ TOPIC                     1,204 │ 88 files with this tag · 96 with it or below  │
│   ▾ finance                   140 │ ● [Show files] [Make a folder] Rename or merge │
│     ▸ tax              88      96 │ Move under… · Move to the top · Refresh · …    │
│   ▸ law                41      41 │ ┌ move topic:tax ── plan ─────────────────────┐│
│ ▾ DOC-TYPE                    380 │ │ 88 files · +88 −88  [Apply]                 ││
│     invoice           212     212 │ └─────────────────────────────────────────────┘│
│                                   │ TO REVIEW 3       [Reject all] [Accept all]   │
│                                   │ UNDER IT · OFTEN WITH IT                      │
└───────────────────────────────────┴───────────────────────────────────────────────┘
```

The heading holds the section tabs, the filter box and **Run organize**. The tabs set `section`:

| Tab | `section` | Shows |
| --- | --- | --- |
| All tags | none | The [tree](#the-tag-tree) and the detail pane |
| Review (ja 要確認) | `review` | The [review queue](#review-queue), with the count of pending items |
| Names (ja 固有名詞) | `names` | [Names](#names) |
| A facet, such as topic | none, `facet=<id>` | The tree narrowed to that facet. The three facets with the most files get a tab, apart from `entity`, which is Names |

Run organize (ja 整理を実行) sets `section=organize`, which opens [Organize](#organize) as a drawer
over the tree. An old `screen=organize` link opens the same drawer.

### The tag tree

The left pane is `list_tag_tree` for the tab's folder and `facet`, as a collapsible tree: each facet a
root, each `/` part a level below it, plain tags after the facets. Each row shows its label, `direct`
(files carrying the tag itself) and `total` (files carrying it or a tag under it). A parent no file
carries itself is implicit: its label is in italics and only `total` shows. The filter box keeps the
rows whose path contains the text, with every level above them open. Up to 500 rows show. A dot on
each row picks the tag's colour, and a tag on files has the [favorite star](#browser) beside it.

| Action | Tools |
| --- | --- |
| Drag a row onto another row | `move_tag` with `parent` set to that row. The plan shows in the detail pane, with Apply |
| Drag a row to the top or bottom edge of a row, or onto a facet's root | `move_tag` with `parent: null`, to the top of its facet |
| Click a row | Selects the tag, as `tag` in the query |

A row of a closed facet cannot be dragged, and its tooltip says why. The tree offers no drop onto the
tag itself, a tag under it, its parent now or another facet, as `move_tag` would refuse them. When a
moved tag lands on a name files already carry, the plan's block says "N files merge into existing
<tag>", from `Plan.merges`. See [Hierarchy](tags.md#hierarchy).

### The detail pane

With no tag selected it shows the last plan made here and the values of open vocabularies, each with
Retire or Activate (`set_vocabulary`). With a tag selected:

| Part | Tools |
| --- | --- |
| Breadcrumb, `topic › finance › tax`, each level above a link | |
| Counts: `direct` and `total` | `list_tag_tree` |
| Colour | `set_config` (`tag_colors`) |
| Star (☆), for a tag on files | `set_favorite_tag`. See Favorites in the [browser sidebar](#browser) |
| Show files | Opens a new tab filtered by the tag |
| Make a folder | Opens Folders with `newfolder=<tag>`, for its New folder dialog |
| Rename or merge | `rename_tag`. When the tag has tags under it, "Include the tags under it" is ticked and sends `children: true` |
| Move under… | A parent picker of the tags in the same facet, then `move_tag` |
| Move to the top | `move_tag` with `parent: null` |
| Refresh | `refresh_candidates`, then `refresh_tag`. See [Refresh](#refresh) |
| Remove from every file | `propose_changes` with `query.tags` and the tab's folder |
| Retire, Activate | `set_vocabulary`, for a value of an open facet |
| N redundant parents | `cleanup_report.redundant_parents` for this tag. Remove the parent plans `propose_changes` with `query.tags: [tag]` and `remove: [parent]` |
| To review | `list_reviews` with `tag`, each item with accept and reject, and both for all. Accepting here makes a plan that waits as a block, unlike the Review section, where the key press is the approval |
| Under it | The tag's children, each with its total |
| Often with it | `suggest_vfolder_tags` with `tags: [tag]` and `tag_match: 'all'`, its `narrows` suggestions |

Every action that changes files makes a plan first, shown as a block in this pane with Apply.

### Organize

`section=organize`, once a screen of its own: a drawer from the right over the tree, opened by Run organize
and closed by `Esc`. It holds `jevonganize organize`, with its flags as controls. Its scope is the
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
- With no key the button is disabled and links to Settings > API keys, as organize would refuse.
- A run keeps going when the drawer closes, in the status bar and the Dashboard.
- Run, under the form, shows each running job. Once it ends, it shows the result, the plan as a block with Apply, and a
  link to any new review items.
- Apply when ready is remembered by the window that started the run, so a reload before the end
  leaves the plan waiting. It never applies a run where every file failed. Items in the review band
  stay in the queue.

### Review queue

`section=review`, once a screen of its own. Grouped by tag, so one decision can cover many files. The
open group is the `tag` param, so a tag selected in the tree opens its group here.

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

### Names

`section=names`, once a screen of its own. Proper names, apart from other tags. It lists `entity` tags in scope and the
active values of `entity`, by count, with a kind filter and a text filter.

| Control | Tool | Effect |
| --- | --- | --- |
| Add | `set_vocabulary` | Registers a name. Each organize then asks about it for every file |
| Pin | `set_vocabulary` | Registers a name found in a file, or unregisters one |
| Show files | | Opens the files in a new tab |
| Rename | `rename_tag`, `apply_plan` | Renames or merges a name |
| Remove | `propose_changes`, `apply_plan`, `set_vocabulary` | Takes it off its files and retires it, so it is not offered again. Undo restores the tags |

There is no run of its own. Names come from `organize`.

### Refresh

Refresh in a tag's detail pane, and Refresh in the browser's title row when the list is filtered to
exactly one tag, open the same dialog. See [Refreshing a tag](tags.md#refreshing-a-tag).

1. **Candidates.** `refresh_candidates` lists the files that lack the tag but look like its files,
   best first, each with its score and the signals that found it: words, tags that go with it, a
   similarity, or its name. Above the list: how many files have the tag, how many are candidates,
   how many were already checked, and the words and tags it learned.
2. **Estimate.** The send notice and the estimate, as in Organize. At most sets how many to check.
3. **Check.** Check N files calls `refresh_tag` with the listed ids. The dialog shows the job's block,
   with its progress and Cancel.
4. **Review.** When it ends, "N files to review" opens Review on the tag. Nothing is tagged until a
   person accepts there.

Empty states: with no file tagged yet, only file names were searched; with no candidates, every file
like these has the tag or was checked. With no key for the provider, Check is off and the dialog
links to Settings > Keys.

## Dashboard

`screen=dashboard`, `g d`. Two panes: the overview, and the history beside it.

```text
┌ Overview ─────────────────────────── [Last 30 days ▾] ┬ History ──── [All plans ▾] ┐
│ ┌ Cost ──┐ ┌ Tokens ┐ ┌ Organized ┐ ┌ Open reviews ┐  │ plan and job blocks,       │
│ │ ≈ $1.24│ │ 3.1M   │ │ 82%       │ │ 12           │  │ newest first               │
│ Cost per day, stacked by feature                      │                            │
│ By feature · By model (calls, tokens, cost)           │                            │
│ Libraries · Kinds of file · Top tags · answer cache   │                            │
└───────────────────────────────────────────────────────┴────────────────────────────┘
```

- **Period.** 7, 30 or 90 days ending today, in `period`. The overview calls `usage_report` from
  local midnight of the first day, by day, and `library_report`. Both refresh when a job ends.
- **Cards.** Cost in the period, tokens in and out, the share of indexed files that are organized,
  and open reviews, which opens Tags at Review. Every amount is approximate, as "≈" or "約", because
  it comes from list prices, and an amount under half a cent shows as "< $0.01", not as free. When `unknown_cost_calls` is above 0 the cost card says "Some prices are
  unknown (N calls)", and those calls are left out of the amount. An estimate before a run counts
  input tokens only, as output is unknown until the answers come back.
- **Daily chart.** One bar per day, stacked by feature from `by_bucket_feature`, drawn as plain SVG.
  Each feature has a fixed colour from the tag tokens, so it keeps that colour when others are
  absent, and both themes are covered. Each bar and segment has a `<title>` with its value, the
  legend names the features, and the tables below carry the same numbers as text.
- **Tables.** Calls, tokens and cost by feature and by model, then each library with its files,
  organized share, failures and last scan, files by kind, and the 10 most used tags as chips that
  open Files filtered to that tag. A line gives the cached answers and the 30-day reuse rate.
- **History**, once the Activity screen, and where `section=history` and the status bar's job lead.
  It lists blocks from `list_plans` and the server's recent jobs, newest first. A status filter
  narrows it to plans of that status, like `plans --status`, and puts that status in `plans`.
- A job's block shows `tokens` and `cost_usd` as the sums of its `usage` rows, so a day's total on
  the Dashboard equals what that day's jobs showed. `test/usage.test.ts` checks this.
- Nothing on the Dashboard leaves the machine: both reports read the local index.

## Facets editor

`screen=facets`, named Questions on the rail (ja 分類項目). Packs on the left, the facet form in the middle, a sample result on the right. Above
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

`screen=settings`, with `section` naming the page. Pages are grouped by task, each with a plain title
and a one-line description at the top. Config keys keep their `snake_case` names and are saved through
`set_config`, as before: only the layout lives in the UI, in `web/views/settings-layout.ts`.

```text
┌ Settings ──────────────┬──────────────────────────────────────────────────────────┐
│ ⌕ Search settings      │ AI MODELS                                                │
│ BASICS                 │ Which model decides tags, which one chats, and which…    │
│   Language and help    │ ┌ Decision model  [Decides every tag] ─────────────────┐ │
│   Folders              │ │ Answers your questions about each file by choosing…  │ │
│   Appearance           │ │ Sends: each file's name, an excerpt of its text, …   │ │
│ AI                     │ │ AI service  [ OpenAI ▾ ]  Recommended. Needs an…     │ │
│ ▸ AI models            │ │ Model       [ gpt-6-luna ]  Leave empty to use …     │ │
│   API keys             │ │ ✓ Key stored on this machine.   [Check the key]      │ │
│ TAGS AND QUESTIONS     │ │ Send images [■]                                      │ │
│   Tagging rules        │ └──────────────────────────────────────────────────────┘ │
│ ADVANCED               │ ┌ Chat model ──────────────────────────────────────────┐ │
│   File list            │ │ (Same as the decision model | A different model)     │ │
│   What is read per file│ └──────────────────────────────────────────────────────┘ │
│   Extraction pipeline  │ ┌ Name-reading model ──────────────────────────────────┐ │
│   Server and speed     │ └──────────────────────────────────────────────────────┘ │
│   Agents               │ EXTRA MODELS FOR SOME QUESTIONS                          │
│   Health               │                              [Discard]  [Save ⌘S]        │
└────────────────────────┴──────────────────────────────────────────────────────────┘
```

| Group | Page (`section`) | Holds |
| --- | --- | --- |
| Basics | Language and help (`general`) | `language`, and Start the tour |
| Basics | Folders (`folders`) | Libraries, `exclude`, `[watch]` |
| Basics | Appearance (`appearance`) | [Theme](#theme), density and UI scale, kept per window in `localStorage`, not config |
| AI | AI models (`models`) | `[provider]`, `[chat]`, `[ner]`, `[profiles]`, `send_images` |
| AI | API keys (`keys`) | `list_keys`, `set_api_key`, `remove_api_key`, `set_env_keys`. A key is never shown |
| Tags and questions | Tagging rules (`tagging`) | `[facets]`, `[thresholds]`, `max_tags`, `fiscal_year_start`, `[tag_colors]` |
| Advanced | File list (`display`) | `[view]` |
| Advanced | What is read per file (`limits`) | `[budget]` |
| Advanced | Extraction pipeline (`pipeline`) | `[[pipeline]]`, as JSON |
| Advanced | Server and speed (`performance`) | `port`, `concurrency` |
| Advanced | Agents (`agents`) | The MCP command with a Copy button. See [llm-native.md](llm-native.md#connecting-a-client) |
| Advanced | Health (`health`) | `doctor`, with Check again, and the paths from `get_config` |

A top-level key that no page names appears on an "Other" page under Advanced, so a new config key still
shows with no UI code. Old `section` values such as `chat`, `thresholds` or `libraries` open the page
that holds them now.

**Search settings**, over the nav, narrows it to pages whose title, description or field names match,
and narrows the fields on the open page too. A match on the page's own title shows the whole page.

### AI models

One card per model, saying what it is for and what it sends:

| Card | Config | Notes |
| --- | --- | --- |
| Decision model | `[provider]` | Marked "Decides every tag". Every tag that `organize` or a refresh adds is decided here, never by the other two |
| Chat model | `[chat]` | The chat panel, `ask`, tag suggestions. Never decides tags |
| Name-reading model | `[ner]` | Proper names out of file text, as `entity:` tags |

- The chat and name-reading cards offer **Same as the decision model** or **A different model**.
  "Same" is not a config value: it copies `[provider]` into that table, and keeps copying while the
  decision model is edited. It shows as selected when the saved tables reach the same model. A
  decision-only service, such as `typesafe`, `cloudflare` or `compatible`, cannot chat, so "Same" is
  then unavailable and the select lists only services that write text.
- Each service shows only the fields it uses: Server address (`base_url`) for `compatible` and
  `chat`, where it is required, and Cloudflare account ID (`account_id`) for `cloudflare`. A
  `base_url` already set on another service stays visible with a warning, since `set_config` merges
  tables and cannot clear it; remove it in `config.toml`.
- The model field's placeholder is the service's default model. Help text sits under every field.
- Missing required fields and an address that is not `http(s)` are marked inline, and Save stays
  disabled until they are fixed.
- Each card shows whether its service has a key, with a link to API keys. **Check the key** on the
  decision card runs `doctor` on the saved config. It does not contact the service.
- Extra models for some questions (`[profiles]`) are edited with the same fields. One is added by
  name. Removing one needs `config.toml`.

### Fields

| Schema | Control |
| --- | --- |
| `object` | A block on its page. Some have a heading and a sentence, such as "How sure the model must be" over `[thresholds]` |
| `boolean` | Switch |
| `integer`, `number` | Number input, with the schema's minimum and maximum |
| `string` with `enum` | Select |
| `string` | Text input |
| `array` of strings | Chip input |
| `array` of objects, such as `pipeline`, and tables with free keys, such as `tag_colors` | JSON text, parsed as you type and validated by `set_config` on save |
| `description` | Help text under the control |

Save sends the changed keys to `set_config`. A validation error comes back as `{ ok: false, error }`
and shows above the form. See [configuration.md](configuration.md). The config tools stay
`agent: false`.

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
about it. This is the Warp idea. The same `Block` serves the dashboard's history, the review queue and
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
| Job running | `⟳` | Progress bar, percent, `done` of `total`, `tokens` (input and output), `cost_usd`, time left, `current`. Both equal the job's recorded `usage` rows, so the Dashboard shows the same figures. A scan has no known total, so its bar only shows activity | Cancel (`cancel_job`) |
| Job `done` | `✓` | Counts, what a scan found, failures and `warnings`. An `organize` job links to its plan | |
| Job `failed`, `cancelled` | `✕` | `error` | |
| Chat tool call | `✓` | The tool's output, truncated | |

- "Show changes" expands the plan's `ops` in a `FileList`, loaded on demand.
- Apply is always `Mod+Enter` or a click. Plain `Enter` never applies.
- "Copy as CLI" copies the equivalent command, such as `jevonganize apply 7f3a9c21`. This teaches
  people and agents the CLI.
- The [Dashboard](#dashboard)'s history, once the Activity screen, lists these blocks.
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
| `>` or none | Also "Add to favorites: <tag>" for each tag of the tab's filter that is not starred yet |
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
| | `g` then `b`, `v`, `t`, `d`, `f`, `s` | Go to Files, Folders, Tags, Dashboard, Questions, Settings |
| | `g` then `o`, `r`, `n`, `a` | Retired aliases, kept for one release: Tags with the Organize drawer, Tags at Review, Tags at Names, and the Dashboard's history |
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
| `Block` | Dashboard history, review, chat | The only way to show a job, plan or tool result |
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
| `scan` | Scan in the browser toolbar, on Organize and in Settings > Folders |
| `organize` | [Organize](#organize), the drawer on Tags |
| `plans`, `apply`, `undo` | The [Dashboard](#dashboard)'s history, with its status filter, and the plan [block](#blocks) |
| `tags list`, `tags rename` | [Tags](#tags): the tree and the detail pane |
| `tags tree`, `tags move`, `tags rename --children` | The [tag tree](#the-tag-tree), with drag and drop, and Move under…, Move to the top and Include the tags under it in the [detail pane](#the-detail-pane) |
| `tags add`, `tags remove` | `t` and `Shift+T` on a selection, and the inspector. Tags can remove a tag everywhere |
| `search`, `show`, `similar` | [Browser](#browser) and inspector |
| `review`, `cleanup` | [Review queue](#review-queue), a section of Tags. Redundant parents also show in a tag's [detail pane](#the-detail-pane) |
| `suggest` | The spark in the inspector's Tags section |
| `refresh` | [Refresh](#refresh) on a tag in Tags, or in the browser filtered to one tag |
| `facets` | [Facets editor](#facets-editor), Questions on the rail |
| `folders` | The [Folders](#folders) screen: its tree, rule bar and New folder dialog |
| `folders suggest` | Suggestions in the [Folders](#folders) tree and its empty screen. `--tags`: the chips and live count of the New folder dialog |
| `config get`, `config set`, `config edit` | [Settings](#settings) |
| `config path`, `doctor` | Settings > Health |
| `auth` | Settings > API keys |
| `ask` | [Chat panel](#chat-panel) |
| `mcp` | Settings > Agents, under Advanced, shows how to connect a client. The client starts the server |
| `report usage`, `report library` | The [Dashboard](#dashboard): `usage_report` fills the cards, the daily chart and the tables by feature and model, and `library_report` the libraries, kinds of file, top tags and open reviews |
| None: `list_favorite_tags`, `set_favorite_tag` | Favorites in the [browser sidebar](#browser), and the star on tag chips, tag tree rows and a tag's detail pane. Starring is a click, so it has no CLI command |

### Tools waiting for their screen

A tool that works from the CLI, chat and MCP before its screen ships is listed here, with the place
it will have, in a table of tool and place. `test/tools.test.ts` checks this list against `web/` both ways, so a
tool leaves it when its screen ships. None is waiting now.

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
├── app.tsx             Shell: panes and overlays, with its bars in components/
├── shell-state.ts      The shell's language, address bar and onboarding
├── api.ts              call(), cached reads, writes
├── events.ts           The events hook, which keeps the cache in step with the server
├── tabs.ts             The tab store
├── view-query.ts       URL query to and from view state and FileQuery
├── screens.ts          The rail's screens, and the old screen ids that lead to them
├── vfolder-query.ts    A view inside a virtual folder, as one FileQuery
├── file-drag.ts        Dragging file ids onto a folder or a favorite, and the drop hook
├── commands.ts         The one command array
├── bindings.ts         Binds its keys, including the `g` chords
├── tokens.css          Tokens and the Tailwind binding
├── components/
│   ├── ui/             Copied shadcn primitives
│   ├── file-list.tsx   The list, with its state in file-list-state.ts and keys in file-list-input.ts
│   ├── file-row.tsx    A tile, a line and the column heads
│   ├── file-icon.tsx
│   ├── tag-chip.tsx
│   ├── favorite-star.tsx  The one star toggle for a tag, and the favorites hook
│   ├── plan-dialog.tsx  A plan a drop stored, as a block in a dialog
│   ├── block.tsx       Plans, jobs and tool results: block-plan.tsx, block-job.tsx, block-shell.tsx
│   ├── pane.tsx
│   ├── filters.tsx     The tab's filters and the any/all switch
│   ├── send-notice.tsx What a run sends and costs
│   ├── palette.tsx     State and keys, with its rows in palette-rows.tsx and search in palette-search.ts
│   ├── tour.tsx        The guided tour's coach mark. Steps and state are in ../tour.ts
│   ├── folder-picker.tsx  State and layout, with its drawn parts in folder-picker-parts.tsx
│   ├── title-bar.tsx   Tabs, the palette button and the theme switch
│   ├── rail.tsx        The screen rail
│   ├── screen-header.tsx  A screen's heading strip
│   ├── status-bar.tsx
│   ├── shortcuts.tsx   The shortcut sheet
│   └── preview/        index.tsx, pdf.tsx, word.tsx, text.tsx
└── views/
    ├── onboarding.tsx  The steps list, with its state in onboarding-state.ts and onboarding-run.ts,
    │                   and the steps in onboarding-steps.tsx
    ├── browse.tsx      Panes and the list, with browse-actions.ts, browse-sidebar.tsx (tags in
    │                   browse-sidebar-tags.tsx, favorites in browse-favorites.tsx), browse-subfolders.tsx, browse-toolbar.tsx,
    │                   browse-dialogs.tsx
    ├── inspector.tsx   The pane, with inspector-file.tsx, inspector-selection.tsx, inspector-folder.tsx
    ├── tags.tsx        The Tags screen: section tabs (tags-tabs.tsx), the filter and Run organize,
    │                   over the tree (tags-list.tsx, rows in tags-list-row.tsx, drag and drop in
    │                   tags-drag.ts) and the detail pane (tags-detail.tsx, tags-detail-sections.tsx,
    │                   tags-move.tsx, tags-rename.tsx, tags-changes.tsx), tag-refresh.tsx with
    │                   tag-refresh-findings.tsx; the Review section in tags-review.tsx, with
    │                   tags-review-queue.tsx, tags-review-item.tsx, tags-review-state.ts and
    │                   tags-review-cursor.ts; the Names section in tags-names.tsx, with
    │                   tags-names-list.tsx and tags-names-state.ts
    ├── organize-drawer.tsx  The Organize drawer, with organize-setup.ts, organize-facets.tsx,
    │                   organize-run.tsx, organize-vocabulary.tsx
    ├── folders.tsx     The Folders screen. The tree in folders-tree.tsx, with folders-tree-list.tsx,
    │                   folders-tree-row.tsx and folders-suggestions.tsx; the rule bar in
    │                   folders-rule-bar.tsx; the dialog in folders-new-dialog.tsx, with
    │                   folders-dialog-fields.tsx, folders-tag-combobox.tsx and folders-rule-hints.tsx;
    │                   drops and removals in folders-plans.tsx
    ├── dashboard.tsx   The Dashboard screen: the overview pane and the history pane, with
    │                   dashboard-data.ts (pure figures and chart layout), dashboard-cards.tsx,
    │                   dashboard-chart.tsx, dashboard-usage.tsx, dashboard-library.tsx,
    │                   dashboard-table.tsx, dashboard-copy.ts and dashboard-history.tsx
    ├── facets.tsx      The shell, with facets-packs.tsx, the editor in facets-form.tsx, facets-sample.tsx
    ├── settings.tsx    The shell. Navigation in settings-nav.tsx, pages in settings-layout.ts, config
    │                   keys in settings-keys.tsx, fields in settings-form.tsx, fixed parts in
    │                   settings-sections.tsx. AI models in settings-ai.tsx, with settings-ai-decision.tsx,
    │                   settings-ai-helpers.tsx, settings-ai-profiles.tsx, settings-ai-fields.tsx,
    │                   settings-models.ts and settings-providers.ts
    └── chat.tsx        The pane, with chat-message.tsx and chat-composer.tsx
```
