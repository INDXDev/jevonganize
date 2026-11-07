# Decision models for Jevonganize: research report

Checked 2026-11-06. No paid API calls were made. Prices come from provider pages or live model catalogs read that day.

Labels:

- **[V]** read in a primary source or in installed code.
- **[M]** run offline against a mock model.
- **[I]** my inference from verified facts.
- **[U]** unverified or conflicting. See section 8.

Bracketed numbers such as [3] refer to Sources (section 9).

## 0. What changes the design

1. **OpenRouter does offer decision models.** It has a native `POST /api/alpha/decisions` endpoint and listed 35 model entries on 2026-11-06. It belongs with the native providers, not the "no endpoint" group. The endpoint is alpha, so "the shape may change". [8][9][10]
2. **OpenAI Decisions is now GA**, not limited preview or public beta. Blogs saying otherwise are out of date. [1]
3. **No decision endpoint accepts PDFs.** Extract text locally, and render pages only when a document has little or no extractable text. [1][5][6][8][13]
4. **Multi-label is not a primitive anywhere.** The AI SDK says so directly. The documented pattern is one `choice` for exclusive categories plus one boolean per tag. [3][11]
5. **The AI SDK already ships the fallback.** `Experimental_DecisionLanguageModel` wraps any `LanguageModelV4`. So `experimental_decide` can be the only call site for every backend. [4][L3]
6. **Clef on Workers AI may silently drop long text.** OpenRouter's docs say Workers AI reads "roughly the first 2,000 tokens" of text state with no error. Cloudflare's own docs say only that long text state is truncated to fit. Do not treat Clef's context window as usable text length until this is tested. [6][9]
7. **"Questions are nearly free" is not universal.** It holds for Jev. It does not hold for Perplexity Flash, which bills `state` once per question. [5][13]

## 1. Request and response shapes

### 1.1 AI SDK (ground truth: installed `.d.ts`)

Installed: `ai` 7.0.162, `@ai-sdk/openai` 4.0.108, `@ai-sdk/typesafe-ai` 3.0.33, `@ai-sdk/gateway` 4.0.135. Latest on npm is one patch ahead of each. The API is experimental and "may change in patch releases", so pin exact versions. [3][L1]

```ts
import { experimental_decide as decide } from 'ai';

const { answers, usage, warnings, rounding, providerMetadata, response } = await decide({
  model,               // DecisionModelV4 instance, or a string resolved via AI Gateway by default
  state,               // string | JSONObject | readonly (TextPart | FilePart | {type:'json', value})[]
  questions: {         // Record<id, question>; answers come back under the same ids
    is_invoice: { type: 'boolean', instructions: 'Is this document an invoice?' },
    doc_type:   { type: 'choice', instructions: 'Which document type is this?',
                  criteria: { invoice: 'A bill for payment', contract: null, other: 'None of these' } },
    sensitivity:{ type: 'score', instructions: 'How sensitive is this document?',
                  criteria: ['Public', 'Internal', 'Confidential'] },   // lowest first, indexed from 0
  },
  maxRetries: 3,       // default 2; also: maxOutputTokens, reasoning, abortSignal, headers, providerOptions
});

answers.is_invoice.probability;        // required, P(true), not confidence
answers.doc_type.choice;               // typed union of option keys
answers.doc_type.probabilities;        // OPTIONAL, Record<option, number>
answers.sensitivity.score;             // fractional, 0..levels-1
answers.sensitivity.probabilities;     // OPTIONAL, keyed '0','1','2'
providerMetadata?.typesafe?.confidence;// per-provider, keyed by question id
```

Rules from the types and core code [L1]:

- `box` answers have normalized `top/bottom/left/right`. Only Jev 1.14 supports it. It always returns a box, even if the target is absent. [3][8]
- `model.supportedQuestionTypes` is checked before any I/O. One unsupported question fails the whole call.
- There is no partial success. Any refused question throws `Experimental_DecisionRefusalError` with `.questionIds`, and it is not retried.
- Core validates that every distribution sums to 1 and that `score` matches the weighted mean. A custom adapter must declare `rounding.probabilityDecimals` or rounded output is rejected.
- Text state passed as an array means parts. To send a JSON array, wrap it in an object or a JSON part. [3]
- Jevlint's real usage: `src/decision/decide.ts` calls `decide({ model, state: content, questions, maxRetries })`. `src/decision/providers.ts` builds models with `createTypeSafeAi(...).decisionModel(id)`, `createOpenAI(...).decisionModel(id)` and `createGateway(...).decisionModel(id)`. [L2]

### 1.2 Native wire formats

The SDK hides these. They matter for custom adapters.

| | OpenAI Decisions | System One (Jev, Clef, OpenRouter) |
| --- | --- | --- |
| Endpoint | `POST /v1/decisions` [1] | `POST /v1/systemone`; Cloudflare `.../ai/run/@cf/cloudflare/clef`; OpenRouter `/api/alpha/decisions` or `/api/v1/systemone` [5][6][8][9] |
| Input | `input`: string or message array; `input_text`, `input_image`, `input_json` | `state`: string, object or array |
| Questions | `questions` **array** with `name` | `questions` **map** by id |
| Binary | `type:'predicate'` -> `probability` | `type:'noul'` -> `noul` (OpenRouter, Cloudflare) |
| Categorical | `choice` with `choices:[{value,description}]` -> `choice`, `probabilities[]`, `confidence` | `choice` with `criteria:{id:desc}` -> `choice`, `probabilities{}`, `confidence` |
| Ordered | `score` with `levels:[{label,description}]` -> `score`, `probabilities[]`, `confidence` | `score` with `criteria:[...]` -> `score`, `legend`, `probabilities{}`, `confidence` |
| Refusal | Per-question `{type:'refusal', name}`; others can still answer [2] | OpenRouter schema has a refusal answer [10]; installed TypeSafe adapter has no refusal handling [L4] |
| Usage | `usage.input_tokens_details.{cached_tokens,cache_write_tokens}` | `usage.input_tokens`, `output_tokens`; OpenRouter adds `cost` |

Snowflake uses the System One shape inside SQL: `AI_COMPLETE(model => 'snowflake-decision', prompt => TO_JSON(...))`. [14]

### 1.3 Limits

| | Questions / request | Choice options | Score levels | Context | Images / request | Formats |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI `gpt-6-luna` | 1-400 [1] | 2-255 [2] | 2-10 [2] | 1,050,000; max input 922,000 [16] | 128 via OpenRouter [9]; direct limit [U] | PNG, JPEG, WebP, GIF in adapter [L4]; data URL or http(s), no `file_id` [1] |
| TypeSafe Jev 1.13, 1.14 | No limit, must fit context [5] | 1-255 [3][18] | 2-10 [3] | 64k per request, 32k per question; 262k with long context, slower and less accurate [5] | Limited by size only [7] | PNG, JPEG; 280-1568 px per side, 16 MiB each, 32 MiB body [7] |
| Cloudflare Clef | 1-64 [6] | 2-255 [6] | 2-10 [6] | 65,536 [6] | 4 [6] | PNG, JPEG, WebP; 4 MiB each, 8 MiB total, 13 MiB body [6] |
| Cloudflare Clef-flash | 1-64 [6] | 2-255 | 2-10 | 24,576 [15] | 4 [15] | As Clef |
| Perplexity Decider v1.2, Flash | >=1 in API; 1-128 in SDK [12][13] | 1-255 [13] | 1-10 [13] | Under 256K [13] | 8 per question [13] | PNG, JPEG, WebP [12] |
| Microsoft-Decision-1 | [U] | [U] | [U] | 32,768 [17][21] | None, text only [9] | n/a |
| Snowflake Decision | [U] | 32 in its benchmark interface [14] | [U] | [U] | [U] | [U] |

Per-model OpenRouter image limits are in its multimodal guide: Clef 4, Liquid 8, Mercury and Baseten 16, Luna 128. [9]

Other OpenAI limits: JSON input is capped at 32 levels, 10,000 values and 256 KiB. Text is capped at 10,485,760 characters. [2]

### 1.4 Rate limits and batching

| Provider | Rate limit |
| --- | --- |
| OpenAI Luna | Build 5,000 RPM / 2M TPM; Launch 10,000 / 10M; Grow 30,000 / 180M [16][20]. Whether `/v1/decisions` shares these is [U] |
| TypeSafe | Per organization, in tokens/s and requests/s, shown in the console; `429` and `529` with `retry-after` [5][18] |
| Cloudflare | Text Generation 300 RPM unless paid-only [19]. Clef's classification as Text Generation comes from its page header [6] |
| Perplexity | 10 requests/s per org; v1.2 15M tokens/min; Flash 4M tokens/min; `429` with `Retry-After` [13] |
| OpenRouter | Global capacity plus an in-flight spending budget. A `402` with `limit_source: openrouter_in_flight_budget` is transient and should be retried [11][22] |

**There is no batch discount path for decisions.** [I]

- The AI SDK does "not ... batch unrelated states". [3]
- OpenAI's Batch guide does not list `/v1/decisions`. [23]
- OpenRouter's Batch API lists chat, responses, messages and embeddings only. [24]

Use bounded concurrency with backoff, as Jevlint does with `p-limit`.

## 2. Multimodal and documents

**Images: yes, on most models.** They are billed as input tokens with no separate charge.

| Model | Image tokens | Cost of one ~1 MP image |
| --- | --- | --- |
| Clef, Clef-flash | One token per 32x32 block, about 65k to 1 MP pixel range, capped at 1,024 per image [6] | Clef $0.00025; flash $0.00004 [I] |
| OpenAI Luna | 32px patches times a model multiplier. `gpt-5.6-luna` is 1.2; `gpt-6-luna` is not in the table [U]. `detail: low` fits 512x512 [25] | About 1,229 tokens, $0.00012 if 1.2 applies [I] |
| Jev | Input tokens at the text price; estimation guidance "soon" [7] | [U] |
| Liquid d1 | 1.5 tokens per patch **for every question** [9] | Grows with question count |

Implementation notes:

- **Jev images are "Dreamer-ready".** TypeSafe says they are not production-ready and limits may change. On OpenRouter, every Jev request with an image runs in long-context mode, which is slower and less accurate. [7][8]
- **Jev rejects undersized images rather than resizing them.** Rotate pixels yourself, because EXIF orientation is not applied. [7]
- **Put an image in `state` once.** Each reference in a question adds another billed copy. [3][7]
- **Clef via Jevlint's route has no image path.** `createTypeSafeAi` uploads multipart, but Clef's schema takes an `images[]` field. Sending images to Clef needs a custom adapter or OpenRouter. [I] [6][L4]
- **`ai-sdk.dev/docs/ai-sdk-core/decisions` is stale on this point.** It says TypeSafe accepts text and JSON only. The provider page and installed code accept PNG and JPEG. [3][L4]

**Documents.** No endpoint takes PDFs. OpenAI states "Files, audio, and item references aren't supported". [1] The adapter's language-model route accepts images only. [4]

Recommended order [I]:

1. Extract text locally. Send `{ path, name, type, size, text }` as JSON state. It is cheapest and works everywhere, including text-only models.
2. If extracted text is under a threshold (scans, slides, photos), render the first few pages to PNG or JPEG and send those.
3. Send both only where layout carries meaning and the model has room. Luna handles this well. Clef's 4-image cap and Jev's experimental status make it a weaker fit there.

Keep state short. TypeSafe reports accuracy falling as irrelevant content grows, so send a head sample rather than the whole file. [26] A filename and path are strong signals and cost little. [I]

## 3. Pricing, latency, availability

All models bill input only. Output is free or zero on every decision model below. Checked 2026-11-06.

| Model | USD / 1M input | Status | Source |
| --- | --- | --- | --- |
| `gpt-6-luna` (Decisions) | 0.10; cached read 0.01; cache write 0.125; 2x above 272K | **GA** | [1][16] |
| Jev 1.13, 1.14 direct | 0.042 | Docs show self-serve console keys; Jevlint says waitlist [U] | [5][L2] |
| Jev via OpenRouter | 0.042 | Alpha API, no waitlist | [8][10] |
| Jev via Vercel Gateway | 0.042 | SDK API experimental | [27] |
| `@cf/cloudflare/clef` | 0.24 | Workers AI, weights Apache 2.0 | [6][28] |
| `clef-flash` | 0.038 | As above | [15][28] |
| `clef-omni` | 0.15 | Adds audio and video | [29] |
| `pplx-decider-v1.2` | 0.02 | Live | [13] |
| `pplx-decider-flash-v1.2` | 0.01, state billed per question | Live | [13] |
| Microsoft-Decision-1 | 0.042 | **Public preview**, not advised for production | [17][21] |
| Snowflake Decision | Not published | **Private preview** | [14] |
| Liquid `d1` / `d1-ultra` | 0.02 / 0.042 | Via Gateway, OpenRouter | [10][27] |
| Baseten Joey / Elephant / Mammoth | 0.01 / 0.035 / 0.10 | 16K context | [10][27] |

OpenRouter also routes Clef through cheaper third parties: clef-flash from $0.018 and clef from $0.192. [10]

Cloudflare's free allocation is 10,000 Neurons/day. [28] That is about 458k Clef tokens or 2.9M Clef-flash tokens per day. [I]

**Example:** 100,000 files, 3,000 tokens of state, 20 questions of 30 tokens each. That is 360M input tokens if state bills once. [I]

| Model | Cost |
| --- | --- |
| Perplexity v1.2 | $7.20 |
| Clef-flash | $13.68, if 3,000 tokens are really read |
| Jev, Microsoft-Decision-1 | $15.12 |
| Luna | $36.00 uncached; up to $45.00 if every token is a cache write |
| Perplexity Flash | $60.60, because state bills 20 times |
| Clef | $86.40 |

**Latency** is all vendor-reported or indirect, and none is independently measured:

| Source | Figure |
| --- | --- |
| Cloudflare's test [28b] | Clef 209 ms median / 239 ms p95; Clef-flash 39 / 122; Jev 524 / 536 |
| OpenAI docs [1] | "about 10x faster than the Responses API" |
| OpenAI staff, quoted by eesel [30] | "less than a few hundreds of milliseconds", unverified |
| Microsoft, via search summary and press (not found in the launch post text) | 35x faster than GPT-6 Sol [U] |

Eesel's 1.46 s median measures Luna on the **Responses API**, not Decisions. Do not cite it as Decisions latency. [30]

For file organization, local text extraction is likely the bottleneck, not model latency. [I]

**Data handling matters for personal files:**

- Clef on Workers AI is listed as zero data retention. [6]
- OpenAI offers ZDR to eligible customers. [1]
- TypeSafe does not train on requests and offers ZDR to enterprise customers. [5]
- Gateway has `zeroDataRetention` and `disallowPromptTraining` options. [L1]

## 4. Best practices

**Wording**

- Ask narrow, atomic questions, one property each. TypeSafe calls this "probably the most important concept". [31]
- Jev reads literally. Write the exact condition and put boundary cases in `criteria`. [26]
- Refer to state fields by name, for example "`text`" or "`path`". [32]
- Put option definitions in `criteria`, not `instructions`. Write descriptions that separate options from each other. [11][18]
- Keep arithmetic, counting and date comparison in code. [26]
- `choice` always picks something. Add `other`, and pair it with a boolean asking whether any option fits. [1][33]
- Jev can favor the first option. Test by reordering. [26]
- English is strongest. CJK works with lower accuracy, so test on Japanese filenames and content. Jev 1.14 notes better multilingual support. [5][34]
- Files are untrusted. An injected instruction can move Jev's answer. [26] Treat results for hostile files as suggestions, and never run actions from them. [I]

**Thresholds and calibration**

- For a boolean, threshold the value itself. TypeSafe suggests starting at 0.7 yes and 0.3 no, with the middle band as its own outcome. [35]
- For `choice`, threshold the chosen option's probability, not `confidence`. `confidence` measures how concentrated the distribution is, and has no fixed meaning across option counts. [35]
- For `score`, use the probability of the level that matters. Position can hide a split. [35]
- Choose per-tag thresholds from 100-200 hand-labeled items using precision and recall. [11]
- Thresholds do not transfer between models. Pin a version, since `jev-latest` moves. [3][5][8]
- Store raw probabilities and apply thresholds later, so tuning needs no new calls. Jevlint does this. [L2][11]
- TypeSafe and Microsoft claim calibration. The SDK promises none across providers. [3][21][36]

**How many questions per call**

- Send all questions for a file in one request. Jev's cookbook measured 13 questions at 12.2x cheaper and 10.0x faster, with no change in answers. [37]
- Questions are independent on Jev. [31] On Perplexity v1.2 they are answered together, so answers change with grouping. Keep grouping fixed when tuning. Grouping helps multi-label facets and hurts competing candidates. [13]
- Send Perplexity Flash one question per request, or avoid it for multi-question schemas. [13]
- Ask speculative questions and ignore irrelevant answers in code. [38]
- Over 255 options, walk a hierarchy with `choice` per level. [39]

**Input-only billing.** On Jev, state is ingested once and each extra question costs only its own tokens. [5] For Luna, per-question state billing is not documented either way [U]; check `usage.inputTokens` on the first real run.

**Prompt caching**

- OpenAI is the only provider whose decision caching rules I read. OpenRouter lists cache-read prices for some others (Liquid, Upstage, Morph, Mercury), and Liquid and Upstage show no discount. [10] For OpenAI, the prefix must be at least 1,024 tokens. Content in `questions` is outside it. An implicit breakpoint sits at the end of `input`. TTL is 30 minutes. [1][2]
- It helps when the same file is re-asked with new questions within the window, such as after a schema edit.
- It may cost more for one-shot-per-file runs. Cache writes are priced at 1.25x, and the implicit breakpoint is on by default. [I] Opting out needs `prompt_cache_options.mode: "explicit"`, but the AI SDK exposes only `promptCacheKey` and `safetyIdentifier`. [2][L1] Check `cache_write_tokens` in `providerMetadata.openai.usage` before estimating cost. [12b]
- The biggest saving is local: cache by content hash, provider, resolved model and question hash, as Jevlint does. [L2] Re-running unchanged files then costs nothing.

## 5. Providers without a decision endpoint

This now means generic OpenAI-compatible servers and local Ollama. OpenRouter has its own endpoint. Neither `@ai-sdk/openai-compatible` 3.0.85 nor `@openrouter/ai-sdk-provider` 3.1.0 exposes `decisionModel`. [L5]

**Recommendation: one adapter, the SDK's own.**

```ts
import { Experimental_DecisionLanguageModel as DecisionLanguageModel }
  from '@ai-sdk/provider-utils/experimental-decision';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const chat = createOpenAICompatible({
  name: 'ollama', baseURL: 'http://localhost:11434/v1', supportsStructuredOutputs: true,
}).chatModel('your-model');
const model = new DecisionLanguageModel({ model: chat });   // pass to experimental_decide
```

What it does [4][L3][M]:

- Sends one structured-output request for all questions, with `reasoning: 'none'`.
- Uses internal keys `q0..` and enum codes `c0..`, so caller ids and labels never hit schema restrictions.
- Tells the model to treat state as data.
- Accepts images only.
- Requires at least two score levels.
- Returns `choice` with no `probabilities`, `score` with no distribution, and a **prompted** P(true) on booleans.

I ran this adapter through `experimental_decide` with a mock language model and all three question types parsed correctly. It has not been run against a real server. [M]

**Limits to design around**

- Prompted probabilities are estimates, not measured distributions. The SDK says to judge them on your own labeled data. [3]
- All answers come from one generation, so later answers can be influenced by earlier ones. [I] Native Jev answers are independent. [31]
- Output tokens are billed on paid chat APIs. Local runs pay in time instead. [I]
- Ollama's cloud does not support structured outputs. [40] Its OpenAI-compatible layer lists logprobs as unsupported, though its native `/api/generate` and `/api/chat` have `logprobs` and `top_logprobs`. [41][42]

**Handling in Jevonganize [I]:** mark these answers `estimated: true`, default them to a stricter threshold, and route `choice` results to review, since no probability exists to threshold.

**Logprobs: defer.** A real distribution is possible with a custom `DecisionModelV4`: one call per question, single-token letter answers, renormalized over `top_logprobs`. [I] It costs N calls per file, depends on tokenizer behavior, and needs Ollama's native API. Add it only if labeled data shows prompted estimates are too weak.

**Local alternative worth testing:** Clef weights are on Hugging Face (`transformers`, Apache 2.0). [28b][43] Any server implementing `POST /systemone` works through `createTypeSafeAi({ baseURL })`. [12c] A ready server for this is [U].

## 6. Design recommendation

**Keep the AI SDK types as the interface.** Every backend is an `Experimental_DecisionModelV4`, so the only model call is `experimental_decide`.

| Backend | Construction | Code needed |
| --- | --- | --- |
| OpenAI | `createOpenAI({apiKey}).decisionModel('gpt-6-luna')` | None |
| TypeSafe | `createTypeSafeAi({apiKey}).decisionModel('jev-1.14.0')` | None |
| Vercel Gateway | `createGateway({apiKey}).decisionModel('typesafe-ai/jev-1.14.0')` | None |
| Perplexity | `perplexity.decisionModel(...)` | None; add the package |
| OpenRouter, text only, Jev | `createTypeSafeAi({apiKey, baseURL:'https://openrouter.ai/api/v1'})` | None; other models here are [U] |
| OpenRouter, all models | Small `DecisionModelV4` against `/api/alpha/decisions` | ~60 lines. Set `rounding.probabilityDecimals: 4`, since sample output is 4 decimals [9] |
| Cloudflare | Jevlint's `cloudflareFetch` wrapper | Copy it, but build the URL from the model id. Jevlint's always calls `clef`. Images need more work |
| Compatible, Ollama | `new DecisionLanguageModel({ model })` | None |

Our `decide` stays thin [I]:

```ts
interface Capabilities {
  maxQuestions: number;      // 64 Clef, 400 Luna, Infinity Jev
  maxImages: number;
  imageTypes: string[];
  maxStateTokens: number;    // real usable text, not the advertised window
  statePerQuestion: boolean; // Perplexity Flash
  native: boolean;           // false for DecisionLanguageModel
}

interface Decision {
  id: string;
  type: 'boolean' | 'choice' | 'score';
  value: number | string;           // P(true), option, or fractional score
  probabilities?: Record<string, number>;
  estimated: boolean;               // prompted, not native
}

decide(state, questions, { model, caps }): Promise<{ answers: Decision[]; usage; modelId }>
```

Responsibilities, in order:

1. Check the cache. Key on content hash, `response.modelId` for the resolved version, question hash and provider.
2. Fit to capabilities: trim state, chunk questions by `maxQuestions`. Chunks repeat the state cost.
3. Call `experimental_decide`.
4. On `Experimental_DecisionRefusalError`, retry without `error.questionIds` and record those as refused, so one question does not lose the file.
5. On a provider auth error, stop the run, as Jevlint's `translateError` does. On anything else, keep the file unclassified with a warning.
6. Normalize and store raw values. Thresholds and tag writing come later.

**Mapping schema fields to questions [I]**

| Schema field | Questions |
| --- | --- |
| One of a closed set | `choice` plus `other`, plus a companion boolean |
| Many of a closed set | One boolean per value |
| Ordered level | `score`, 2-10 levels |
| Numeric, date | Parse in code; the model only picks bins, if needed |
| Over 255 options | Hierarchical `choice` |
| Open tags | Pipeline below |

**Open tag suggestion [I]**

Decision models cannot invent labels: OpenAI points to Structured Outputs for generated fields, and OpenRouter and TypeSafe both document generate-then-verify cascades. [1][44][45]

1. **Reuse first.** Ask a boolean for each tag already in the user's vocabulary. This is cheap, and most files stop here.
2. **Suggest only where coverage is low.** For files with no confident tag, use one chat call (`generateText` with `Output.object`) that returns up to about 8 candidates, given the existing vocabulary so it reuses terms. A sample of files per folder is cheaper than every file.
3. **Normalize in code.** Lowercase, slugify, and merge exact duplicates. Drop candidates that match existing tags.
4. **Verify with decisions.** Send the same state plus one boolean per candidate, such as "Is this file primarily about {tag}?". Cached state on Luna makes this step cheaper if it follows within 30 minutes.
5. **Gate on a person.** New tags have no labeled data, so use a conservative fixed threshold such as 0.8 and show them as suggestions. After acceptance, the tag joins the vocabulary and step 1 handles it.

Verification checks that a tag fits, not that it is useful, so `document` will pass. A vocabulary review step handles that. OpenRouter's Extractions API (`/api/alpha/extractions`) is an alternative for step 2 with `list` fields, and some models there read PDFs. [46] It is alpha, so keep it optional.

**Default provider suggestion [I]:** OpenAI is the only native API I confirmed is labelled GA, and the only one Jevlint has tested live. [1][L2] Jev is cheaper and strong, but its images are experimental. OpenRouter is the widest single key but alpha. Measure on a labeled file sample before fixing a default.

## 7. Verified

Sections 0-6 carry a per-claim label. Items checked most directly:

- SDK call shape, answer types, refusal path and `DecisionLanguageModel`: read in installed `.d.ts` and `.js`, plus one offline mock run.
- OpenAI GA status, question limits, price and caching rules: OpenAI guide and API reference.
- Jev limits, price, image rules and thresholds: TypeSafe docs.
- Clef schema, limits and image tokenization: Cloudflare model pages and JSON schemas.
- OpenRouter endpoints, adapters and live catalog: its docs and `GET /api/v1/models?output_modalities=decisions`.
- Gateway catalog and prices: `GET ai-gateway.vercel.sh/v1/models`.

## 8. Unverified or conflicting

| Topic | Conflict or gap | Action |
| --- | --- | --- |
| Clef text limit | OpenRouter: Workers AI reads about 2,000 tokens, silently. Cloudflare: 65,536 context, "truncated to fit" | Test with a marker at the end of a long state |
| Clef context | Blog 64k; model page 65,536. Blog's "Jev 32k, text only" is out of date | Use model page |
| Jev context | TypeSafe 64k/32k (262k opt-in); Gateway 32,000; OpenRouter 262,144, with over ~32 KB text or any image forced into long-context mode | Treat default as 32k per question |
| Jev access | Jevlint and search results say waitlist; TypeSafe quickstart says get a key from the console | Confirm at signup |
| Jev rate limits | Community wiki 250k tok/s, 1,200 RPM [48]; eesel 100K tok/s, 40 RPS [30]; docs say per-org [5] | Use console values |
| Jev minimum image size | TypeSafe 280 px; OpenRouter 256 px | Use 280 |
| OpenAI status | Blogs: limited preview, public beta. OpenAI: GA | Use OpenAI |
| OpenAI refusal in SDK | `ai-sdk.dev` OpenAI page says `InvalidResponseDataError`; installed code raises `Experimental_DecisionRefusalError` | Handle both |
| Luna image limit | 128 from OpenRouter; OpenAI's general guide says 1,500 images and 512 MB; Decisions limit not stated | Cap at 128 |
| Luna image tokens | `gpt-6-luna` absent from OpenAI's patch tables | Read `usage` |
| Luna rate limits | Model-level table only | Watch `429` |
| Luna state billing | Not stated whether state bills once for multi-question requests. Jevlint's docs assume so | One test call |
| Implicit cache write cost | [I] from docs; not observed | Check `cache_write_tokens` |
| Microsoft-Decision-1 | Output "free" vs "N/A"; Jev-protocol endpoint shown only in a tutorial using `TypeSafeClient` [17b]; Jevlint marks direct route experimental. GA claims in blogs conflict with Microsoft's public preview | Prefer OpenRouter or Gateway |
| Snowflake | Limits, price, latency, multimodal absent; 57.63 score is vendor-run | Exclude; needs account team |
| Latency | All vendor figures; Wavect notes the Clef table does not establish production latency [47] | Measure |
| OpenRouter `usage.cost` | Sample in the multimodal guide implies about $0.09/M for clef-flash, against a $0.038 list price | Read `usage.cost` |
| OpenRouter `/systemone` | Non-Jev models and multipart images unconfirmed. `/alpha/decisions` rejects multipart `part` | Use `/alpha/decisions` |
| Firecrawl, DataCamp, Medium explainers | Not found or read; primary docs replaced them | None |
| OpenAI Batch for decisions | Absent from the guide's list; not explicitly excluded | Assume none |

## 9. Sources

Web, all read 2026-11-06:

1. OpenAI, Decisions guide: https://developers.openai.com/api/docs/guides/decisions
2. OpenAI, create decision reference: https://developers.openai.com/api/reference/resources/decisions/methods/create
3. AI SDK, Decisions: https://ai-sdk.dev/docs/ai-sdk-core/decisions
4. AI SDK source, `decision-language-model.ts`: https://github.com/vercel/ai/blob/main/packages/provider-utils/src/decision-language-model.ts
5. TypeSafe, Models: https://docs.typesafe.ai/models
6. Cloudflare, Clef model page and input schema: https://developers.cloudflare.com/workers-ai/models/clef/ and https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json
7. TypeSafe, Images: https://docs.typesafe.ai/images
8. OpenRouter, Jev hub: https://openrouter.ai/docs/guides/community/jev
9. OpenRouter, Multimodal Decisions: https://openrouter.ai/docs/guides/community/multimodal-decisions
10. OpenRouter, Decisions API reference and live catalog: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request and https://openrouter.ai/api/v1/models?output_modalities=decisions
11. OpenRouter, Classify and Tag cookbook: https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-classification
12. AI SDK, Perplexity provider: https://ai-sdk.dev/providers/ai-sdk-providers/perplexity
12b. AI SDK, OpenAI provider: https://ai-sdk.dev/providers/ai-sdk-providers/openai
12c. AI SDK, TypeSafe provider: https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
13. Perplexity, Decisions quickstart: https://docs.perplexity.ai/docs/decisions/quickstart
14. Snowflake blog: https://www.snowflake.com/en/blog/snowflake-decision-cortex-ai-functions/
15. Cloudflare, Clef-flash: https://developers.cloudflare.com/workers-ai/models/clef-flash/
16. OpenAI, GPT-6 Luna: https://developers.openai.com/api/docs/models/gpt-6-luna
17. Microsoft launch post: https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-microsoft-decision-1-in-microsoft-foundry-for-decision-and-classific/4562742
17b. Microsoft tutorial: https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/build-a-grounded-package-upgrade-advisor-with-microsoft-decision-1/4568374
18. TypeSafe, Choice and errors: https://docs.typesafe.ai/primitives/choice and https://docs.typesafe.ai/api/errors
19. Cloudflare, Limits: https://developers.cloudflare.com/workers-ai/platform/limits/
20. OpenAI, Rate limits: https://developers.openai.com/api/docs/guides/rate-limits
21. Microsoft Learn, Foundry Models sold by Azure: https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
22. OpenRouter, Limits: https://openrouter.ai/docs/api_reference/limits
23. OpenAI, Batch: https://developers.openai.com/api/docs/guides/batch
24. OpenRouter, Batch API: https://openrouter.ai/docs/guides/features/batch-api
25. OpenAI, Images and vision: https://developers.openai.com/api/docs/guides/images-vision
26. TypeSafe, Model jaggedness: https://docs.typesafe.ai/model-jaggedness
27. Vercel AI Gateway live catalog: https://ai-gateway.vercel.sh/v1/models
28. Cloudflare, Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
28b. Cloudflare blog: https://blog.cloudflare.com/clef-decision-models/
29. Cloudflare, Clef-omni: https://developers.cloudflare.com/workers-ai/models/clef-omni/
30. eesel (pointer only): https://www.eesel.ai/blog/openai-decisions-api
31. TypeSafe, How to build: https://docs.typesafe.ai/concepts/how-to-build-with-system-one
32. TypeSafe, Primitives and State: https://docs.typesafe.ai/primitives and https://docs.typesafe.ai/concepts/state
33. TypeSafe, Companion Noul: https://docs.typesafe.ai/patterns/companion-noul
34. TypeSafe, Changelog: https://docs.typesafe.ai/changelog
35. TypeSafe, Confidence and Noul: https://docs.typesafe.ai/confidence and https://docs.typesafe.ai/primitives/noul
36. TypeSafe, AI primer: https://docs.typesafe.ai/introduction/machine-learning-primer
37. TypeSafe, Parallel questions: https://docs.typesafe.ai/cookbooks/parallel_questions
38. TypeSafe, Speculative fan-out: https://docs.typesafe.ai/patterns/fan-out
39. TypeSafe, Hierarchical classification: https://docs.typesafe.ai/cookbooks/hierarchical_classification
40. Ollama, Structured outputs: https://docs.ollama.com/capabilities/structured-outputs
41. Ollama, OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
42. Ollama, Generate API: https://docs.ollama.com/api/generate
43. Hugging Face, Clef: https://huggingface.co/Cloudflare/clef
44. OpenRouter, Jev-verified cascade: https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-verified-cascade
45. TypeSafe, SDE cascade: https://docs.typesafe.ai/cookbooks/sde_cascade
46. OpenRouter, Extractions API: https://openrouter.ai/docs/guides/community/extractions
47. Wavect review (pointer only): https://wavect.io/blog/cloudflare-clef-vs-jev/
48. Community wiki (pointer only): https://github.com/cobusgreyling/Jev/wiki

Local, read-only:

- L1. `../jev-cleancode/node_modules/.pnpm/`: `ai@7.0.162` `dist/index.d.ts`, `dist/index.js`; `@ai-sdk/provider` `dist/index.d.ts`; `@ai-sdk/gateway` and `@ai-sdk/openai` `dist/index.d.ts`
- L2. `../jev-cleancode/src/decision/{decide,providers,pricing}.ts`, `docs/concepts.md`, `docs/providers.md`
- L3. `@ai-sdk/provider-utils@5.0.74` `dist/experimental-decision/index.d.ts`
- L4. `@ai-sdk/typesafe-ai@3.0.33` and `@ai-sdk/openai@4.0.108` `dist/index.js`
- L5. npm tarballs of `@ai-sdk/openai-compatible@3.0.85` and `@openrouter/ai-sdk-provider@3.1.0`, searched for `decisionModel`
