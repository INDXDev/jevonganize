# Presets

A facet is one attribute of a file. A preset is a facet that ships with Jevonganize. There are 102, in
11 packs. Custom facets use the same format. A separate [topic catalog](#topic-catalog) ships with them.

```toml
[facets]
enabled = ["core", "time", "sensitivity", "media"]   # packs, or single facet ids
disabled = ["is-template"]                           # wins over enabled
```

The list above is the default. Each file is asked only the enabled facets whose `applies_to` matches
its MIME type. The shape of a facet is `Facet` in [`src/types.ts`](../src/types.ts).

## Facet kinds

| Kind | Use it for | Tag | Example |
| --- | --- | --- | --- |
| `flag` | A binary attribute. Present means yes, absent means no or unknown | `flag:<id>` | `flag:has-signature` |
| `choice` | One category from a closed set | `<id>:<label>` | `doc-type:invoice` |
| `multi` | Any number from a closed set | `<id>:<label>`, one per label | `topic:finance/tax` |
| `level` | One step on an ordered scale | `<id>:<label>` | `confidentiality:restricted` |
| `date` | A year, or a year and month, stated in the file | `<id>:<YYYY>` or `<id>:<YYYY-MM>` | `doc-date:2026-03` |
| `field` | A value copied from metadata, such as the author. No model call | `<id>:<value>` | `author:yamada-taro` |

**Numbers become bands.** Use a `level` such as `amount:1k-10k`. Exact values would create a new tag per
file, which floods tag lists and says nothing to similarity.

**Skip what the file system knows.** Extension, size and modified time are in the index, and need no
tag.

## Facet files

`presets/<pack>.toml` ships with the app. `<config dir>/facets/*.toml` holds yours. One bad file gives
a warning and is skipped. It never stops the others.

```toml
pack = "finance"
title = "Finance"

[[facet]]
id = "invoice-state"
title = "Invoice state"
kind = "choice"
instructions = "What is the payment state of this invoice? Judge by what the file records, not by its name."
applies_to = ["application/*", "image/*"]
weight = 1.0

[facet.values]
paid = "It shows the invoice was paid: a receipt, or a paid stamp."
unpaid = "It asks for payment that is still due."
```

| Field | Kinds | Default | Meaning |
| --- | --- | --- | --- |
| `id` | All | Required | Lowercase kebab-case. Unique across all packs. `flag` is reserved |
| `title` | All | Required | Shown in the UI. Not sent to the model |
| `kind` | All | Required | One of the six kinds |
| `instructions` | All but `field` | Required | The question |
| `values` | `choice`, `multi` | Required | Label to one-line definition. The definition is the prompt |
| `levels` | `level` | Required | Labels, lowest first. 2 to 10. The label `none` writes no tag |
| `precision` | `date` | `year` | `month` also asks for the month |
| `field` | `field` | Required | A [metadata key](pipeline.md#filestate) |
| `format` | `field` | None | `year`, `month` or `fiscal-year` |
| `aliases` | All with labels | None | Old label to current label, applied after the answer |
| `applies_to` | All | `[]` | MIME globs. Empty means every file |
| `open` | `multi` | false | Accepted suggestions become new values |
| `weight` | All | 1 | Weight in [similarity](storage.md#similarity). 0 leaves it out |
| `apply_above` | All but `field` | None | Overrides `thresholds.apply` |
| `profile` | All but `field` | None | A [named model](providers.md#profiles) |

These are errors at load time, and that facet is skipped:

- A duplicate `id`, or an `id` of `flag`.
- A label named `other`, which is reserved.
- A label that breaks the [tag grammar](tags.md#grammar).
- More than 254 labels on a `choice`, since `other` makes 255.
- Fewer than 2 or more than 10 `levels`.
- A `multi` with no `values`, unless it is `open`.
- A key that does not belong to the kind.

A test over all presets also checks that the default packs fit Clef's 64 questions per request.

The other kinds look like this:

```toml
[[facet]]
id = "has-signature"
title = "Has a signature"
kind = "flag"
instructions = "Does the file show a handwritten or electronic signature? A typed name alone does not count."
applies_to = ["application/*", "image/*"]

[[facet]]
id = "confidentiality"
title = "Confidentiality"
kind = "level"
instructions = """How restricted is the readership of this file? \
none: nothing suggests a limit, or the question does not apply. \
internal: meant for one organisation or household. \
confidential: marked or written for named people only. \
restricted: serious harm if leaked, such as legal, medical or security content."""
levels = ["none", "internal", "confidential", "restricted"]
weight = 0.25
apply_above = 0.95

[[facet]]
id = "doc-date"
title = "Document date"
kind = "date"
precision = "month"
instructions = "What date does the file itself state as its date of issue? Ignore dates in its name."
applies_to = ["application/*", "text/*", "message/*", "image/*"]

[[facet]]
id = "fiscal-year"
title = "Fiscal year"
kind = "field"
field = "created"
format = "fiscal-year"

[[facet]]
id = "author"
title = "Author"
kind = "field"
field = "author"
```

## Packs

| Pack | For | On by default |
| --- | --- | --- |
| `core` | What a file is and how much it matters | Yes |
| `time` | When it dates from and what falls due | Yes |
| `parties` | Who wrote it, and who it involves | No |
| `projects` | What work it belongs to | No |
| `finance` | Money | No |
| `legal` | Contracts and records | No |
| `sensitivity` | Whether it needs care | Yes |
| `media` | Photos, screenshots, audio | Yes |
| `work` | Office and technical files | No |
| `housekeeping` | Clutter | No |

### core

| Id | Kind | Purpose |
| --- | --- | --- |
| `doc-type` | `choice` | What it is: invoice, receipt, contract, letter, report, form, manual, statement, certificate, notes |
| `topic` | `multi`, open | What it is about. A topic counts only if it covers about a fifth of the file |
| `language` | `choice` | Main language of the text: `en`, `ja`, `zh`, `ko`, `de`, `fr`, `es` |
| `status` | `choice` | How you use it: active, reference, archive |
| `importance` | `level` | Cost of losing it: none, low, normal, high |
| `is-draft` | `flag` | Marked or written as an unfinished draft |
| `is-template` | `flag` | A blank form or template, meant to be filled in |
| `is-scan` | `flag` | A scan or photo of a paper document |
| `has-signature` | `flag` | Shows a handwritten or electronic signature |
| `needs-action` | `flag` | Asks the reader to do something, such as reply or pay |

### time

| Id | Kind | Purpose |
| --- | --- | --- |
| `year` | `field` | Calendar year of `created`: `year:2024` |
| `month` | `field` | Calendar month of `created`: `month:2024-03` |
| `fiscal-year` | `field` | Fiscal year of `created`, from `fiscal_year_start`: `fiscal-year:FY2025` |
| `doc-date` | `date`, month | Date the file states as its date of issue |
| `event-date` | `date`, month | Date of the event it describes, such as a trip or a meeting |
| `due-date` | `date`, month | Date something is due |
| `expiry-date` | `date`, month | Date it stops being valid |
| `period` | `choice` | Span it covers: day, week, month, quarter, year, several-years |
| `is-recurring` | `flag` | One of a repeating series, such as a monthly statement |
| `is-time-sensitive` | `flag` | Loses its value after a stated date |

`created` comes from the file's own metadata. A file with no embedded date gets no `year`, `month` or
`fiscal-year` tag, because the file system's date is not reliable after a copy. `doc-date` covers
these files from their content.

A fiscal year is named after the calendar year it starts in. With `fiscal_year_start = 4`, March 2026
is `FY2025` and April 2026 is `FY2026`.

### parties

| Id | Kind | Purpose |
| --- | --- | --- |
| `party` | `multi`, open | The people or organisations it is with |
| `author` | `field` | Author, from document or image metadata |
| `last-author` | `field` | Last person to edit it, from `last_author` |
| `company` | `field` | Company, from Office metadata |
| `sender` | `field` | Sender of an email, from `from` |
| `recipient` | `field` | First recipient of an email, from `to` |
| `party-type` | `choice` | Main other party: person, company, government, bank, school, clinic |
| `my-role` | `choice` | Your role in it: payer, payee, employee, customer, tenant, patient, student |
| `is-official` | `flag` | Issued by a government, court or other authority |
| `has-letterhead` | `flag` | Carries an organisation's letterhead or logo |

### projects

| Id | Kind | Purpose |
| --- | --- | --- |
| `project` | `multi`, open | The named project it belongs to |
| `area` | `choice` | Area of life: work, home, health, money, study, family, travel, hobby |
| `phase` | `choice` | Project stage: proposal, planning, in-progress, delivery, closed |
| `is-deliverable` | `flag` | A finished output handed to someone |
| `is-client-work` | `flag` | Made for an outside client |
| `is-meeting-note` | `flag` | Notes, minutes or an agenda from a meeting |
| `is-plan` | `flag` | Sets out goals, a schedule or a budget |
| `has-tasks` | `flag` | Lists tasks or to-dos |
| `has-decision` | `flag` | Records a decision that was made |
| `is-research` | `flag` | Background material collected for reference |

### finance

| Id | Kind | Purpose |
| --- | --- | --- |
| `invoice-state` | `choice` | Payment state: paid, unpaid |
| `amount` | `level` | Size of the main total: none, under-100, 100-1k, 1k-10k, 10k-100k, over-100k |
| `currency` | `choice` | Main currency: `jpy`, `usd`, `eur`, `gbp`, `cny`, `krw` |
| `tax-year` | `date`, year | Tax year it relates to |
| `expense-type` | `choice` | Spending category: travel, food, rent, utilities, equipment, software, medical, insurance |
| `payment-method` | `choice` | How it was paid: card, bank-transfer, cash, direct-debit |
| `is-tax-relevant` | `flag` | An accountant would need it for an annual tax return |
| `is-reimbursable` | `flag` | Proof of a cost someone may pay back |
| `is-bank-statement` | `flag` | A statement of a bank or card account |
| `is-payslip` | `flag` | A payslip or salary statement |

### legal

| Id | Kind | Purpose |
| --- | --- | --- |
| `contract-type` | `choice` | Kind of contract: employment, lease, sale, service, loan, licence |
| `contract-state` | `choice` | Stage shown: draft, signed, terminated |
| `jurisdiction` | `choice` | Law that governs it: `jp`, `us`, `eu`, `uk` |
| `retention` | `level` | How long it is usually kept: none, months, years, permanent |
| `record-class` | `choice` | Kind of record: personal, tax, employment, medical, property, education |
| `is-nda` | `flag` | A non-disclosure agreement |
| `auto-renews` | `flag` | States that it renews unless cancelled |
| `is-legal-notice` | `flag` | A formal notice, claim or summons |
| `is-certificate` | `flag` | A certificate or official proof, such as a degree or registration |
| `is-insurance` | `flag` | An insurance policy or claim |

`retention` is a hint about common practice. It is not legal advice.

### sensitivity

| Id | Kind | Purpose |
| --- | --- | --- |
| `confidentiality` | `level` | Readership: none, internal, confidential, restricted |
| `has-pii` | `flag` | Identifies a living person with details such as address or birth date |
| `has-credentials` | `flag` | Shows a password, API key or recovery code |
| `has-health-data` | `flag` | Health, diagnosis or treatment details |
| `has-financial-data` | `flag` | Account or card numbers |
| `has-government-id` | `flag` | A passport, licence or national ID number |
| `has-child-data` | `flag` | Personal details of a child |
| `visibility` | `choice` | Public or not: public, private |
| `has-trade-secret` | `flag` | Unpublished business or technical secrets |
| `has-legal-privilege` | `flag` | Advice from a lawyer to a client |

All of these use `weight = 0.25`. They apply at the same threshold as any facet, so a wrong guess is
written. Set `apply_above` in a custom copy to hold them back.

**No preset claims a file is safe.** There is no `not-sensitive` and no `safe-to-delete`, because a
hostile file could give itself that tag. The lowest step of `confidentiality` is `none`, which writes no
tag, so nothing is claimed when nothing showed.

`visibility:public` says what the file appears to be, not that sharing it is harmless. A hostile file
can give itself that tag too, so it must not
be used as a security control. Files neither public nor private get no tag.

A tag such as `flag:has-credentials` is visible to anyone who can read the file's attributes. It also
tells them where to look.

### media

| Id | Kind | Purpose |
| --- | --- | --- |
| `is-screenshot` | `field` | From [screenshot detection](pipeline.md#screenshots) |
| `image-kind` | `choice` | Photo, scan, diagram, chart, illustration, meme, screenshot |
| `scene` | `choice` | Setting of a photo: indoor, outdoor, city, nature, event, workplace |
| `subject` | `multi` | Main subjects: people, pet, food, landscape, building, vehicle, document, whiteboard |
| `has-people` | `flag` | People are recognisably visible |
| `has-text-in-image` | `flag` | Text is readable in the image |
| `audio-kind` | `choice` | Music, voice-memo, meeting, podcast, sound-effect |
| `artist` | `field` | Artist, from audio tags |
| `album` | `field` | Album, from audio tags |
| `camera` | `field` | Camera make and model, from EXIF |

### work

| Id | Kind | Purpose |
| --- | --- | --- |
| `doc-purpose` | `choice` | Aim: inform, propose, request, record, teach, sell |
| `audience` | `choice` | Intended reader: self, team, company, customer, public |
| `department` | `choice` | Function: engineering, sales, marketing, finance, hr, legal, operations |
| `code-language` | `choice` | Programming language of a source file: `typescript`, `python`, `go`, `rust`, `java`, `c`, `shell`, `sql` |
| `technical-depth` | `level` | Background needed to follow it: none, general, informed, expert |
| `is-source-code` | `flag` | Program source, not prose about it |
| `is-config` | `flag` | A settings or configuration file |
| `is-data-export` | `flag` | Rows of data dumped from a system |
| `is-resume` | `flag` | A CV or resume |
| `is-training-material` | `flag` | Course, tutorial or onboarding content |

### housekeeping

| Id | Kind | Purpose |
| --- | --- | --- |
| `quality` | `level` | Legibility of a scan or image: none, poor, usable, good |
| `is-blank` | `flag` | Has almost no content |
| `looks-broken` | `flag` | Content is garbled or cut off |
| `is-encrypted` | `field` | From `encrypted` metadata |
| `is-installer` | `flag` | An installer or disk image |
| `is-temporary` | `flag` | A cache, log or scratch file |
| `is-marketing` | `flag` | An advert, newsletter or promotion |
| `is-superseded` | `flag` | States that a newer version replaces it |
| `looks-like-copy` | `flag` | Its name suggests a copy, such as `(1)` or `final2` |
| `archive-content` | `choice` | Main content of an archive: photos, documents, code, installers, mixed |

These tags describe. Jevonganize never deletes anything, and offers no "keep or delete" facet.

### Weights

Facets not listed use `weight = 1`.

| Facets | Weight |
| --- | --- |
| `project` | 2 |
| `party`, `doc-type`, `topic` | 1.5 |
| `status` | 0.5 |
| `language` and all of `sensitivity` | 0.25 |

These starting values are judgements.

## Writing questions

The wording is the classifier, so it matters more than any setting.

1. **Ask one thing.** One narrow property per facet. This is the most important rule.
2. **Name what can be seen.** Ask about visible features, not intentions.
3. **Be literal.** Models read literally. State the exact condition, and decide edge cases in advance:
   "A typed name alone does not count."
4. **Put definitions in `values`, not in `instructions`.** The question asks. The definitions separate.
5. **Define a label against its nearest neighbour.** An invoice "asks for payment that is still due",
   and a receipt "shows payment already made".
6. **Say what to ignore.** "Judge by what the file records, not by its file name." Names and metadata
   can mislead, or be written by an attacker.
7. **Refer to state by name**, such as `text` or `metadata`, when one source matters.
8. **Leave a way out.** `choice` has the implicit `other`. A `level` needs a lowest step named `none`
   for "does not apply". It writes no tag, so a file with no total never gets `amount:under-100`.
9. **Make adjacent levels clearly different.** Keep to the fewest levels that are useful.
10. **Keep arithmetic in code.** Do not ask a model to count, add or compare dates.
11. **Write in English.** Accuracy is strongest there, even for files in other languages.
12. **Try it.** Use a file that should match and one that should not. Then reorder the labels, since
    Jev can favour the first option.

A `level` has labels and no separate definitions, so `instructions` must define each step. See
`confidentiality` above.

Never write a label that says a file is safe.

## How facets become questions

`toQuestions` builds SDK questions, and all of a file's questions go in one request. `fromAnswers`
turns the results into `Answer` rows.

| Kind | Question ids | SDK type | `Answer.value` | `Answer.confidence` |
| --- | --- | --- | --- | --- |
| `flag` | `<id>` | `boolean` | `yes` | P(true) |
| `choice` | `<id>` | `choice`, labels plus `other` | The label. Null for `other` | Probability of that label. Null if none is given |
| `multi` | `<id>.<label>` | One `boolean` per label | The label, one answer each | P(true) for that label |
| `level` | `<id>` | `score`, 2 to 10 levels | The label at the rounded score | Probability of that level. Null if none is given |
| `date` | `<id>.year`, `<id>.month` | Two `choice` questions | `YYYY` or `YYYY-MM`. Null when the year is `other` | The lower of the two probabilities |
| `field` | None | No model call | | |

- **`other`** is added to every `choice`, and to both `date` questions, with the definition "None of
  the other options fits, or the question does not apply." An answer of `other` writes nothing. It is
  still stored, so it is not asked again.
- **`multi`** instructions are the facet's `instructions`, followed by the label and its definition. A
  boolean per value is the documented pattern, because no decision API has a multi-label question. Each
  label costs one question.
- **`level`** thresholds use the probability of the chosen level, not `confidence`, which measures how
  concentrated the distribution is. If a level's score is 1.6, the label is the one at index 2.
- **`date`** year options are generated: every year from 1990 to 2039. The span is a fixed constant.
  If it moved with the clock, `facetHash` would change each January, and every date answer would be
  paid for again. A file dated outside it answers `other`. Month options are `01` to `12`. A year with
  a month of `other` gives `YYYY`, with the year's probability. `year` precision asks no month.
- **`field`** runs `derive`, which needs no model call and sends nothing.

### Field values

Metadata is written by whoever made the file, so `derive` cleans it:

1. For `format`, parse the date and write `YYYY`, `YYYY-MM` or `FY<year>`. A date that does not parse
   gives no tag.
2. For a boolean value, `true` writes `flag:<id>` and `false` writes nothing.
3. Otherwise convert to a string, and keep the part before the first `,` or `;` if the key is `to`.
4. Apply NFC, remove `\p{Cc}` and `\p{Cf}`, and lowercase.
5. Replace the [forbidden characters](tags.md#portable-encoding) and `/` with a space, then join words
   with `-`.
6. Cut the result to fit 64 characters in total. An empty result gives no tag.

So `Doe, Jane` becomes `author:doe-jane`. A hostile file can still choose its own `author` tag, but
it cannot break the grammar.

## Thresholds

`resolve` runs after the cache, and is pure. Changing a threshold needs no model call.

```toml
[thresholds]
apply = 0.5
review = 0.50
estimated_to_review = true
```

For each answer, take the first row that fits:

| # | Answer | Result |
| --- | --- | --- |
| 1 | Refused, or `value` is null | Nothing |
| 2 | The tag is already in `existing` | Nothing |
| 3 | The facet is single-valued, and `existing` has one of its tags | Nothing |
| 4 | `confidence` is null | Review |
| 5 | `confidence` is below `thresholds.review` | Dropped |
| 6 | `estimated` is true and `estimated_to_review` is on | Review |
| 7 | `confidence` is at or above `apply_above`, or else `thresholds.apply` | Apply |
| 8 | Anything else | Review |

An alias is mapped to its current label before these checks.

`existing` holds human tags, plus AI tags of facets outside this run. Organize leaves out AI tags of
the facets it just asked, so a new answer can replace them. Any of those it no longer supports join
the plan's `remove`: that includes an answer of `other`, or a `level` of `none`. A refusal says nothing
either way, so a refused facet keeps its tags, which then count as `existing`. A human tag always beats an answer: if you tagged a file `doc-type:invoice`, the
model cannot add `doc-type:receipt`.

**Sensitivity gets no special treatment.** Its answers apply at `thresholds.apply` like any other.

**The defaults are assumptions.** They come from no measurement, and do not transfer between models.
To set them well, label 100 to 200 of your own files and pick per-facet values with `apply_above`.
Every accept and reject in review is a data point. Pin a model version first.

## Tag count

Aim for 3 to 6 tags per file, with a hard cap of 10. This follows library cataloguing practice: "a
maximum of six is appropriate", and "do not assign more than ten".

- **The aim** is met by choosing packs. Nothing enforces it.
- **The cap** is `max_tags`, and it counts tags a person added. It binds what organize adds, not a
  plan a person writes by hand or a review item they accept. `entity:` tags do not count.
- **Each `multi`** keeps its top 3 labels.

If a file would go over the cap, candidates are ranked by facet `weight`, then by confidence, then by
tag text. `field` tags rank with confidence 1. Only the top tags that fit join the plan. The others
are dropped, not reviewed, and their answers stay cached. Human tags are never dropped, so a file with
10 human tags gains nothing. An AI tag kept for review counts too. `apply_plan` checks the cap again,
and refuses an op that a person's later tags pushed over it.

## Open facets

`topic`, `party`, `project` and `entity` are open: they can gain values. They are the only presets
that are.
A decision model cannot invent a label, so a chat model suggests and a person decides. This keeps
principle 5, closed output: an unreviewed model string never reaches a tag.

`topic` ships with seed values, such as `finance` and `finance/tax`. The others start empty, and ask
nothing until they have a value. `entity` normally stays empty: `names` writes its tags directly, so
each new name does not become one more question for every file.

| State | Meaning | On disk? | Asked? |
| --- | --- | --- | --- |
| `proposed` | A chat model suggested it. It is a `suggest` review item with null confidence | No | No |
| `active` | A person accepted it, on one file. It becomes a normal label | Yes, on that file | Yes |
| `retired` | A person rejected it, or stopped using it | Existing tags stay | No |

1. `suggest_tags` calls `suggest()` with the file's state and the active vocabulary. It uses the
   `[chat]` model, which is not always the `[provider]` model.
2. Code normalizes each candidate: lowercase, kebab-case, at most 64 characters. It drops anything that
   is not `<open facet>:<value>`, is already active or retired, or breaks the grammar. It keeps at most
   8.
3. A person accepts or rejects in the review queue, grouped by tag.
4. An active value joins the facet's `values`, with the definition `The file clearly concerns "<value>".`

Two values that mean one thing are merged with an alias. `cleanup_report` lists near-duplicates,
one-file tags and tags on over half of all files.

**This has a cost.** A new active value changes the facet's hash, so the next organize asks that whole
facet again for every file in scope. Accept in batches, and check `estimate` first.

## Topic catalog

`presets/catalog.txt` holds subjects as `<domain>/<concept>`, such as `finance/budgeting`. They are not
facets, so nothing asks about them until one joins `topic`. Most domains are `topic` seeds, so
`topic:finance` also finds `topic:finance/budgeting`, and the domain tells `nature/python` from
`technology/python`.

`jevonganize topics pick` chooses for a folder, with no review:

1. It takes the folder's file names, sampled evenly down to `budget.text_chars`. No content and no paths.
2. **Sweep.** Every catalog value competes, in choice questions of 254 options, 8 to a request. No tree
   is walked, so a wrong early branch cannot hide a good topic.
3. **Confirm.** The 1,000 values with the best odds each get a yes-or-no question, which turns down
   anything that fits almost any folder.
4. The 100 likeliest at 0.5 or above become active values of `topic`, leaving out values already
   active or retired. A model only selects, so this keeps closed output.

Choice questions carry the sweep because a question costs about 155 tokens before its text, measured
on `gpt-6-luna` on 2026-11-07. Across about 110,000 topics on 12 file names, a yes-or-no question each
took 19.6M tokens, $1.97 and 40 seconds, and its top picks were vague, such as
`language/human-written-text`. The sweep took 1.4M tokens, $0.14 and 4 seconds, and its top picks were
concrete, such as `finance/invoices`. With the confirm step, a whole run took 1.6M tokens, $0.16 and 8
seconds. The file names are billed once per request, not per question.

The vocabulary is global, because there is no per-folder config. Each added value is one more question
for every file organized, and changes `topic`'s hash, so the next organize asks `topic` again.

Names come from Wikipedia's Vital Articles level 4 (CC BY-SA 4.0), IPTC Media Topics (CC BY 4.0) and
OpenAlex (CC0), with everyday subjects added by `gpt-5.4-mini`, which also filed every name under a
domain. Those filings are a model's, so some are wrong. `scripts/catalog.ts` rebuilds the file.

## Proper names

Every `organize` run also tags files with the names they contain. There is no separate run:

1. The `has-proper-names` flag asks the decision model whether a file names specific things. Its
   answer is cached like any other.
2. Only files it passes go to the `[ner]` model, which lists names with a kind: `person`,
   `organization`, `place`, `product`, `project` or `event`.
3. A name the file does not literally contain is dropped, and so is one found only in the file's own
   name.
4. The rest become `entity:<kind>/<name>` in the run's plan, at most 8 per file. They sit outside
   `max_tags`, so a full file still gets them, and a run never replaces them. There is no review
   step. `undo` reverses it.

A name you register, with `jevonganize names add` or on the Names screen, joins `entity`, so the same
run asks about it for every file. Without a `[ner]` key, a run reads no names and asks only about
registered ones.

## Re-tagging

Answers are cached per facet, so most changes need no model call. `estimate` shows the count and cost
first, and every change that writes tags goes through a plan.

| Change | Model calls | How |
| --- | --- | --- |
| Change thresholds, `apply_above` or `max_tags` | 0 | Resolve runs again on cached answers |
| Change a facet's `weight` or `title` | 0 | Outside `facetHash` |
| Change `fiscal_year_start` | 0 | `field` tags are derived again |
| Rename a label | 0 | Add an alias and keep the old label in `values`, then `rename_tag` rewrites disk |
| Merge two labels | 0 | Alias one to the other, then `rename_tag` |
| Add, edit or remove a `field` facet | 0 | Derived from stored metadata |
| Disable or remove a facet | 0 | A `cleanup` plan removes its AI tags. Human tags stay |
| Move, or copy with the same name | 0 | The state is unchanged, so the answer key matches |
| Add a facet, or enable a pack | One per file in scope | The file's state is sent again, so it is billed again |
| Add a label, or accept a vocabulary value | One per file in scope | `facetHash` changed |
| Edit `instructions`, a definition or a label's key | One per file in scope | `facetHash` changed |
| Split a label | Files holding the old label | As above. Organize with a query on the old tag, so only they are asked |
| Rename a file | One per file | `name` is part of the state |
| Change a budget or the pipeline | Files whose state really changed | `state_hash` changed |
| Change `send_images` | Files that had images | `state_hash` changed |
| Change model or provider | 0 until you organize | The key changed. Spot-check a sample before a full run |

A file with any facet in scope lacking a current answer goes back to status `new`. Nothing runs until
you start an organize.

Renaming a key in `values` directly works, but costs a full re-ask. An alias does not.

## Writing a custom facet

Create `<config dir>/facets/household.toml`, or use the UI, which calls `save_facet`:

```toml
pack = "household"
title = "Household"

[[facet]]
id = "appliance"
title = "Appliance"
kind = "choice"
instructions = "Which home appliance is this manual or warranty for? Judge by the text, not the file name."
applies_to = ["application/pdf", "image/*"]

[facet.values]
fridge = "A refrigerator or freezer."
washer = "A washing machine or dryer."
aircon = "An air conditioner or heater."
```

1. Choose the kind. Prefer `flag` or `choice`, and use `field` when metadata already has the answer.
2. Write the question using the [rules above](#writing-questions).
3. Add the pack or id to `[facets] enabled`.
4. Run `estimate` to see the cost, then organize one small folder.
5. Read the plan and the review queue. If answers are wrong, rewrite the wording first.

A custom facet with a preset's id replaces that preset. Delete it to go back.

A facet from someone else is prompt text plus tag names. Read its labels before enabling it.
