# Providers

A provider runs the decision model. File content goes to the provider you choose, and to no other.
Every provider sits behind one call, `experimental_decide` from the
[AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/decisions). Only `ai/` imports it. The API is
experimental, so versions are pinned exactly.

```toml
[provider]
name = "openai"
model = "gpt-6-luna"
# base_url, account_id: for providers that need them
```

| `name` | Default model | Key variable | Built with | Notes |
| --- | --- | --- | --- | --- |
| `openai` | `gpt-6-luna` | `OPENAI_API_KEY` | `@ai-sdk/openai` | **Recommended default.** The only decision API confirmed as generally available |
| `typesafe` | `jev-latest` | `TYPESAFE_AI_API_KEY` | `@ai-sdk/typesafe-ai` | Direct Jev access. Cheaper, but images are experimental |
| `gateway` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` | `@ai-sdk/gateway` | Vercel AI Gateway. Also reaches other decision models |
| `cloudflare` | `clef` | `CLOUDFLARE_API_TOKEN` | Fetch wrapper over the TypeSafe client | Workers AI. Needs `account_id`. Text only for now. See [the Clef concern](#clef-and-the-2000-token-concern) |
| `openrouter` | None, set `model` | `OPENROUTER_API_KEY` | Custom adapter, `ai/openrouter.ts` | Calls the **alpha** endpoint `/api/alpha/decisions`. Its shape may change |
| `compatible` | None, set `model` | `JEVONGANIZE_API_KEY` | `@ai-sdk/typesafe-ai` with `baseURL` | Anything that speaks the Jev protocol at `base_url` |
| `chat` | None, set `model` | `JEVONGANIZE_CHAT_API_KEY`, optional | `@ai-sdk/openai-compatible`, in the SDK's decision wrapper | Any OpenAI-compatible chat model, such as Ollama or Groq. Answers are flagged [estimated](#the-chat-provider) |

Why `openai` is the default: it is the one option that is generally available, accepts images, and
needs no account step beyond an API key. This is a judgement, made without a measured comparison.
Measure on your own files before settling.

## No fallback

**With no key for the configured provider, the job refuses to start.** It never tries another
provider, because that would send your files somewhere you did not choose. The same applies to a
profile a facet needs, and to a `base_url` that is missing.

| Failure | Behaviour |
| --- | --- |
| No key | `resolveModel` throws a `UserError`. Nothing is sent |
| Key rejected (401, 403) | The job stops at once, since every file would fail the same way |
| Model refuses a question | Retry without those questions, and record them as refused |
| Rate limit | The SDK retries with backoff. The file is marked failed if that runs out |
| Any other provider error | That file is marked failed with a warning. The job continues |

Run `estimate` to see which provider and model a run would use before anything is sent.

## Limits

Checked 2026-11-06, from provider documentation. None was tested live.

| | Questions per request | Choice options | Score levels | Context | Images per request | Image formats |
| --- | --- | --- | --- | --- | --- | --- |
| `gpt-6-luna` | 1 to 400 | 2 to 255 | 2 to 10 | 1,050,000, input up to 922,000 | 128 reported via OpenRouter. Direct limit unknown | PNG, JPEG, WebP, GIF |
| Jev 1.13, 1.14 | No limit, must fit context | 1 to 255 | 2 to 10 | 64k per request, 32k per question. Sources disagree, so plan on 32k | Limited by size | PNG, JPEG. 280 to 1,568 px per side, 16 MiB each |
| Clef | 1 to 64 | 2 to 255 | 2 to 10 | 65,536, but see [below](#clef-and-the-2000-token-concern) | 4 | PNG, JPEG, WebP. 4 MiB each |
| Clef-flash | 1 to 64 | 2 to 255 | 2 to 10 | 24,576 | 4 | As Clef |

Facets stay inside these limits by design: at most 255 options with `other`, and 2 to 10 levels.
Jevonganize always sends JPEG.

- **More questions than a request allows:** questions split into chunks, and each chunk sends the
  state again, so it is billed again. This matters on Clef with many enabled packs.
- **Unsupported question type:** one unsupported type fails the whole call. The provider's
  `supportedQuestionTypes` is checked before any request.
- **More images than a request allows:** extra images are dropped, with a warning.
- **Text-only routes:** `cloudflare` in v1 sends no images, because the TypeSafe client uploads them in
  a way Clef's schema does not accept. Images are dropped, with a warning. Use `openrouter` to reach
  Clef with images. Microsoft-Decision-1 takes no images on any route.
- **PDFs and Office files:** no decision endpoint accepts them. See [pipeline](pipeline.md).
- **Batching:** no decision API offers a batch discount. Jevonganize uses `concurrency` with backoff.
- **Prompt caching:** `promptCacheKey` is not set, because it changed nothing. Measured on `gpt-6-luna`
  on 2026-11-07 with 3,000-token synthetic files: only a byte-identical request read the cache, with or
  without a key. The per-call marker makes every real request differ, even for one file, so each call
  writes about 89% of its input to the cache and reads none. `estimateCost` counts those tokens at the
  normal price, so a bill can run up to a quarter above it.
- **Concurrency:** on one OpenAI key, 64 synthetic files took 18.8 s at `concurrency = 2`, 5.1 s at 8,
  3.3 s at 16 and 2.2 s at 32 or 64. 400 files at 32 took 9.4 s with no failures. Limits depend on the
  account, so the default stays 8.

## Prices

USD per million input tokens, checked **2026-11-06**. Decision models bill input only. Prices are built
in, so they can go stale. Your provider's bill is the real figure.

| Model | Route | Price | Notes |
| --- | --- | --- | --- |
| `gpt-6-luna` | `openai` | 0.10 | Cached read 0.01, cache write 0.125, double above 272k tokens |
| Jev | `typesafe`, `gateway`, `openrouter` | 0.042 | |
| `clef` | `cloudflare` | 0.24 | OpenRouter lists third-party routes from 0.192 |
| `clef-flash` | `cloudflare` | 0.038 | OpenRouter lists third-party routes from 0.018 |

Output tokens have a table of their own, checked **2026-11-07**. Every model above bills its decision
output at 0, so a decision call costs its input. `estimateCost` adds input and output; an estimate
before a run counts input only. `gpt-6-luna` used as the `[chat]` model bills output at a rate not in
the table yet, so recorded chat costs on it run low.

`estimateCost` returns null for any other model, and for `compatible` and `chat`. A run then shows
tokens with no cost, and the usage report counts such calls as having no known price. On `openrouter`, prefer the `usage.cost` a response reports.

Estimates assume 4 characters per token, which runs low for Japanese and Chinese. Whether Luna bills
the state once or per question is not documented, so check `usage.inputTokens` on a first real run. On
OpenAI, a cache write costs 1.25 times a normal token, and the SDK offers no way to opt out, so
one-shot runs may cost up to 25 percent more than the base price.

As a rough guide, 100,000 files with 3,000 tokens of state and 20 questions of 30 tokens each is 360M
input tokens. That is about $15 on Jev, $36 on Luna and $86 on Clef, if state bills once.

## Pin a version

The answer key uses the model id you configured. `jev-latest` moves when a new version ships, but its
cached answers stay and thresholds do not transfer between versions. Use a fixed id such as
`jev-1.14.0` if you want results to stay comparable.

## Profiles

A profile is a named extra model. A facet names one with `profile`.

```toml
[profiles.vision]
name = "typesafe"
model = "jev-latest"
```

```toml
[[facet]]
id = "image-kind"
profile = "vision"
```

Each profile used for a file is one more request, and the state is billed again. Facets without a
`profile` stay in the default request. A profile that does not exist, or has no key, stops the job
before it starts.

`[chat]` is separate. It picks the model for the chat panel and for
[tag suggestions](presets.md#open-facets), so it must be a text-generating model, not a decision
model. It can be a different provider from `[provider]`, so file state may go to both.

`[ner]` is a third model. `organize` uses it to read proper names out of files that hold them, and it
defaults to OpenAI's `gpt-5.4-mini`. With a local `[provider]`, set `[ner]` too, or that text goes to
OpenAI.

## Setup

Store keys with `set_api_key`, in the settings screen or from the [CLI](cli.md). They go in
`credentials.toml`, with mode `0600`. Never put a key in `config.toml`.

### OpenAI

Create an API key at [platform.openai.com](https://platform.openai.com). The default config works as
it is.

OpenAI offers zero data retention to eligible customers.

### TypeSafe AI (Jev)

Get a key from [typesafe.ai](https://typesafe.ai). Its quickstart says keys come from the console, and
other sources mention a waitlist. Confirm when you sign up.

```toml
[provider]
name = "typesafe"
model = "jev-1.14.0"
```

TypeSafe does not train on requests, and offers zero data retention to enterprise customers.

### Vercel AI Gateway

```toml
[provider]
name = "gateway"
model = "typesafe-ai/jev"
```

### Cloudflare Workers AI

Create an API token with Workers AI permission, and find your account ID in the dashboard.

```toml
[provider]
name = "cloudflare"
model = "clef"                     # or clef-flash
account_id = "your-account-id"
```

The request URL is built from the model id. Clef on Workers AI is listed as zero data retention.

### OpenRouter

List models with `GET https://openrouter.ai/api/v1/models?output_modalities=decisions`, and set one.

```toml
[provider]
name = "openrouter"
model = "your-chosen-model"
```

A `402` with `limit_source: openrouter_in_flight_budget` is temporary, and is retried. Every Jev
request with an image runs in long-context mode there, which is slower and less accurate.

### Jev-compatible endpoints

Anything that accepts `POST <base_url>/systemone` with the Jev request shape.

```toml
[provider]
name = "compatible"
model = "jev-latest"
base_url = "https://litellm.example.com/typesafe/v1"
```

### The `chat` provider

For a server with no decision endpoint. The server needs structured output support.

```toml
[provider]
name = "chat"
model = "your-model"
base_url = "http://localhost:11434/v1"    # Ollama. Use Groq's URL, and so on, for others
```

A local model keeps your files on your machine, and needs no key. Ollama's cloud does not support
structured outputs.

It runs through the SDK's `Experimental_DecisionLanguageModel`, so it uses the same call as the other
providers. It is weaker in ways that matter:

- **Answers are estimates.** Booleans carry a prompted probability, not a measured one, so
  `estimated` is true.
- **`choice` and `level` carry no probability.** `confidence` is null, so they always go to review.
- **With `estimated_to_review` on, which is the default, nothing applies on its own.** Every tag waits
  in the review queue. Turning it off lets `flag` and `multi` answers apply, and nothing else.
- **Answers can influence each other,** because they come from one generation. Native Jev answers are
  independent.
- **Output tokens are billed** on paid chat APIs. Local runs pay in time.
- **Images** work only if the model takes them.

## Test status

Only `openai` has been called live. Everything else comes from provider documentation and installed
SDK code.

On 2026-11-06, one fictional invoice went to `gpt-6-luna` through `experimental_decide`, with
`boolean`, `choice` and `score` questions, Japanese text in the state, and question ids containing
`.`, `/` and Japanese characters. All were accepted. `choice` and `score` returned `probabilities`,
and `score` keys them by level index. Warm calls took about 340 ms, from one run on one machine.
A generated WebP settings screen, sent as a `file` part, was correctly judged a screenshot, at 642 input
tokens for the image and two questions.

| Provider | Status |
| --- | --- |
| `openai` | Tested live with text and one WebP image, including `choice` and `score` |
| `typesafe` | Not tested. Official SDK provider |
| `gateway` | Not tested. Official SDK provider |
| `cloudflare` | Not tested. Jevlint's wrapper passed against a fake server only |
| `openrouter` | Not tested live. The adapter passed against a stubbed endpoint only |
| `compatible` | Not tested. Shares the `typesafe` path |
| `chat` | The wrapper parsed all three question types with a mock model. Never run against a real server |

Reports are welcome.

## Known concerns

### Clef and the 2,000-token concern

OpenRouter's documentation says Workers AI reads "roughly the first 2,000 tokens" of text state, with
no error. Cloudflare's own page lists a 65,536-token context, and says only that long text is
truncated to fit. These do not agree, and neither was tested.

If OpenRouter is right, Clef sees about 2,000 tokens and the rest is lost silently. The guard and
metadata come first in the [state](pipeline.md#how-the-model-state-is-assembled), so they survive. The
file's text would be cut, and the end of a long document never read. 8,000 characters of English is
about 2,000 tokens, so it would barely fit. 8,000 characters of Japanese would not.

Until someone tests it with a marker at the end of a long state, do not rely on Clef for long text.
If you use it, consider a lower `budget.text_chars`.

### Jev on Japanese, Chinese and Korean text

TypeSafe says English is strongest, and that CJK works with lower accuracy. Jev 1.14 notes better
multilingual support. No figures were found. Test on your own Japanese file names and content before
trusting thresholds. Write facet questions in English, whatever the language of your files.

### Other Jev details

- Images are "Dreamer-ready": TypeSafe says they are not production-ready, and limits may change.
- An injected instruction in a file can move an answer. See [security](security.md).
- Jev can favour the first option in a list.

### Comparability

Answers from different models are not comparable, and the SDK promises no calibration across
providers. Changing model means new thresholds.
