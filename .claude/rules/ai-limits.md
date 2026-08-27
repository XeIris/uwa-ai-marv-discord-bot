---
paths:
  - "utils/ai.ts"
  - "utils/aiPricing.ts"
  - "utils/aiModeration.ts"
  - "utils/aiSessionLock.ts"
  - "utils/llmRetry.ts"
  - "utils/aiConsent.ts"
  - "utils/sessionFlag.ts"
  - "database/models/AiChatModel.ts"
  - "commands/ai*.ts"
  - "commands/summary_*.ts"
  - "classes/handlers/keywordsBehaviorHandler.ts"
  - "database/models/AiUsageModel.ts"
  - "database/models/AiConsentModel.ts"
  - "utils/aiTools.ts"
  - "utils/imageGen.ts"
  - "commands/ai_tools.ts"
  - "database/models/AiToolPreferenceModel.ts"
---

# AI usage limits, routing, moderation, consent & retry

`utils/ai.ts`, `utils/aiPricing.ts`, `utils/aiTools.ts`, `AiUsageModel`, `AiToolPreferenceModel`.

Per-user fixed windows (`DAILY_LIMIT` / `WEEKLY_LIMIT` in `utils/ai.ts`) metered in **credits**, not
raw tokens:

```text
credits = tok_in × mult_in + tok_out × mult_out
```

where $0.28/M = 1x. **The per-model multiplier table lives in `utils/aiPricing.ts` — read it there,
it moves.** Two rules that don't move: unlisted models are 1x/1x, and listed promotional discounts
are ignored (multipliers track list price).

Models in `FREE_MODELS` (`openrouter/free`, which `TitleGen` runs on) are 0x/0x **and** skip the
reservation entirely — free to run, so they never consume credits and can't be blocked by credit
exhaustion. That exemption is about **price only**: the consent gate sits upstream of model choice
and still fails closed, so a free model is no route around `ensureAiConsent`.

The multiplier and `CONTEXT_LIMITS` tables are keyed by **model id, not persona**, and deliberately
still list models no configured persona uses — they're a reference for whatever a persona is pointed
at next, not a description of what's wired up today.

The `AiUsage` audit log keeps raw tokens + derived USD `cost`; the `AiRateLimitWindow.tokens` column
stores **credits** (name kept, no rebuild).

Enforcement is `db.aiUsage.tryReserve(userId, estCredits)` → `release()` in `finally` — an
in-memory in-flight reservation held for the whole generation so concurrent spam can't all pass the
check before usage lands. **No dev bypass — everyone is metered.**

## Generated images

Image models are billed **per image**, not per token, so they can't ride the multipliers.
`MODEL_USD_PER_IMAGE` holds the list price and `creditsForImages()` converts it at the same
$0.28/M = 1x base, times `IMAGE_CREDIT_MULTIPLIER` (1.5x). `runImageGeneration` reserves before the
call, releases in a `finally`, and charges via `addImageUsage` **only when an image actually
shipped** — the audit row logs zero tokens and the true list cost, so `AiUsage.cost` stays a
real-money ledger while the window carries the surcharge.

An unpriced image model bills **nothing** — a new one must be added to `MODEL_USD_PER_IMAGE` or it
generates for free. Today: `meta/muse-image` $0.01 (53,571 credits) and
`google/gemini-3.1-flash-lite-image` $0.03363 (180,161 credits), against a 250k daily budget.

`IMAGE_GEN_DAILY_LIMIT` (5/day) still applies on top — it caps burst, the credits cap spend.

## Retry

All OpenRouter chat calls go through `createChatCompletionWithRetry` (`utils/llmRetry.ts`):
per-attempt timeout (180s default, 480s music-compose, 60s titlegen), a 600s overall budget across
attempts, and 2s/4s/8s/16s backoff on 408/409/429/5xx/network **only**. The shared client sets
`maxRetries: 0` so SDK retries don't stack — don't raise it.

## Dual model routing

A persona may split one conversation across two models: `model` (+ `providerRouting`) runs text
turns, `visionModel` (+ `visionProviderRouting`) runs turns carrying attachments the chat model must
read. `resolveTurnModel(persona, hasReadableMedia)` in `utils/ai.ts` is the only place that decides,
and **every consumer of one turn must ask it the same question** — history trimming and the
text-only retry after a media failure included, or a fallback text turn silently bills at vision
prices.

Marv is the only invokable persona at all, and the one dual-routed one:
`deepseek/deepseek-v4-flash-0731` for text, `openai/gpt-5.6-luna` for images. This is a capability split before it is a cost split — DeepSeek V4
Flash is **text-only** on OpenRouter, so without the vision route every attached image would be
dropped. It does support `tools`, so club tools, web search and the media-generation tools all work
on the text route.

`providerRouting` on Marv sorts DeepSeek endpoints by price with `data_collection: "deny"` and
`require_parameters: true` (tools must be supported). That routing is why
`CONTEXT_LIMITS['deepseek/deepseek-v4-flash-0731']` in `utils/tokenizer.ts` is 256k, not the
advertised 1M — a deliberately conservative floor, since `require_parameters` and price sorting can
land the turn on a small-context endpoint (CoreWeave and Reka both serve 256k). Note the *cheapest*
endpoints today serve the full 1M, so the 256k budget currently trims harder than it needs to; a
retune wants live endpoint data, not a guess.

`reasoning` / `visionReasoning` are the same idea for OpenRouter's `reasoning` body field. Marv's
text route sets `{ "enabled": false }`: DeepSeek V4 Flash otherwise spends ~150 reasoning tokens and
~18s on a one-line chat answer (measured; ~10s and 0 with it off) and bills them as completion
tokens, and tool calling is unaffected either way. The **music composing turn is exempt** — the
request builder skips the override once `musicGuideRead` is set, because working out an arrangement
is the one place thinking pays for itself.

DeepSeek V4 Flash bills at **0.29x/0.64x** ($0.08/M in, $0.18/M out). The slug is served by ~28
OpenRouter endpoints spanning $0.03–$0.44 in and $0.10–$1.32 out, and Marv routes it by price with
fallbacks, so there is no single true rate: the table is pegged to the 5th-cheapest endpoint, which
covers the realistic landing band without charging ceiling prices on the common path. (It billed
0.5x/1x until 2026-08-27 — the rate of a slug we no longer use, a ~2.3x overcharge.) `AiUsage.cost`
still ignores provider-side prompt caching, so it remains an upper bound.

## Image generation transport

`runImageGeneration` picks its transport per model. `IMAGES_API_MODELS` (`utils/imageGen.ts`) lists
the ids OpenRouter serves **only** on `POST /api/v1/images` — `meta/muse-image` today, which is what
Imgen runs on. Those get `{ model, prompt, n }`, with reference images (attached-image edits and
Marv's self-portrait) as `input_references`, taking the exact `image_url` parts `utils/aiMedia.ts`
already builds. Hybrids (the Gemini/GPT image models) keep going through `chat/completions` with
`modalities`. Sending an images-only model to `chat/completions` 404s.

**How to classify one:** it is images-endpoint-only when `GET /api/v1/models/<id>/endpoints`
resolves but the id is absent from the plain `GET /api/v1/models` list. muse-image is such a model —
an unlisted eval endpoint (`muse-image-1.0-eval-*`), which is why `IMAGE_GEN_FALLBACK_MODEL` stays
the publicly-listed Gemini model rather than following Imgen to muse.

Both envelopes converge on `{ base64, mime }` before the size/attachment checks, and the extension
comes from the endpoint's own `media_type` (webp for muse). `aiModeration`'s
`GENERATED_IMAGE_MIMES` whitelists webp, so generated images are still screened.

## Per-user tool switches

`/ai tools tool:<name> option:<enable|disable|view>` — per user, global across servers, backed by
`AiToolPreference` (`db.aiTools`). Keys live in `AI_TOOL_KEYS` (`utils/aiTools.ts`): `websearch`,
`imagegen`, `musicgen`, `diagrams`, `pdf`. `all` is a **command target only, never a stored key**,
and every key is whitelisted before it reaches SQL.

**Everything is ON by default** — a missing row means enabled, and the table stores exceptions only.
This is the deliberate inverse of upstream, which defaults everything off: Marv exists to be useful
to club members who will never read a settings command.

**Club tools are not switchable.** The constitution, roster, events, reference sheets and unit
lookup are this fork's reason to exist and Marv's only source of truth about the club.

`resolve()` fails to the **default (all on)**, not all-off, and logs. These are preferences, not a
safety control — an unreadable exceptions table means "no known exceptions", and silently stripping
web search and image generation mid-conversation on a transient DB error is the worse failure.

The switches only ever **subtract**: a persona without `webSearchEnabled` still gets no web search,
and the media tools stay gated on session memory on top of the switch. Preferences are resolved for
**every** persona, memoryless ones included — `pdf` and `websearch` need no session memory, so a
user who turned them off must be honoured regardless of which persona answers. Wired into
`keywordsBehaviorHandler` (the only tool-bearing surface); `/summary` uses no tools. With `pdf` off,
an attached PDF gets a notice saying how to turn it back on rather than being silently dropped.

The effective web-search answer is computed **once per turn** and passed to both `generateContent`
and `trimHistoryToFit`. Trimming reserves extra context for the search tool schemas, so a
disagreement costs the user history to a budget the request never spends.

## System prompt

No wall-clock timestamp goes in the system prompt. The date line changes once a day; a timestamp
changes every request, which busts the provider's prompt cache on every single turn for the whole
system prompt — and the user's own message already carries a UTC timestamp
(`formatMessageWithTimestamp`). **Don't re-add a `(System clock: ...)` line.**

The `<<PDF_ATTACHMENT>>` untrusted-content paragraph is conditional: it is only included on turns
whose prompt or replayed history actually contains `PDF_ATTACHMENT_MARKER` (`utils/pdf.ts`).

## Chat flags

`utils/sessionFlag.ts` parses single-letter flags off the message before the model sees it, and
`parseSessionFlags` strips every one it knows:

- **`-n`** — start a fresh session (`startNewSession`).
- **`-f`** — forget the last turn (`AiChatModel.undoLastTurn`): the user's last message, the reply
  to it, and any `tool` audit rows in between. History rows are only ever appended, so "id >= the
  newest `user` row" is exactly the trailing turn; the read and the delete share a transaction and
  the caller holds the session lock.

Both are **standalone commands** — the handler acts and returns rather than also answering. `-n`
wins when both are present, since a fresh session already discards the last turn.

`-f` **refuses on a moderation-paused session**. Deleting history wouldn't clear
`moderation_flagged` either way, but refusing keeps `-f` from looking like a way out of a pause.

These replace the base repo's bare command words ("kys", "amnesia"), which matched anywhere in a
message and fired on ordinary sentences containing them. **A new chat command should be a flag
here, not a word the model could see.**

## Content-safety moderation

Off by default; `GlobalConfig.ai_moderation = 1` turns it on globally (`utils/aiModeration.ts`).
When on, **every** session-backed AI turn — every persona, every user, no exemptions — is screened
twice by the `Moderation` persona (`data/aiPersonas.json`, an NVIDIA Nemotron content-safety
classifier that takes **no system prompt**): once on the user message before generating, once on the
user+assistant pair before delivery. Its reply is plain-text labels (`User Safety:` /
`Response Safety:` / `Safety Categories:`), parsed by `parseModerationOutput`.

A trip sets `AiChatSession.moderation_flagged` (`flagSessionModeration`) — the session is paused
permanently, `active` deliberately untouched so `getOrCreateSession` keeps returning and refusing
it. The turn is neither delivered nor persisted; the user gets `MODERATION_PAUSED_MESSAGE` and must
start a new chat (`-n`). `/summary` is sessionless and reply-and-drops with
`MODERATION_BLOCKED_MESSAGE` instead.

**The screen never costs credits.** It calls `createChatCompletionWithRetry` directly, bypassing
`generateContent` — so no `tryReserve`, no `addUsage`, no entry in the credit ledger at all. **Don't
route it through `generateContent`** — that would start billing users for being moderated.

**The screen fails open** — an outage, timeout, or unparseable label logs and allows the turn. A
free classifier must never be able to take down every conversation on the bot. Budgets are tight for
the same reason (15s per attempt, 20s overall): the screen runs twice per turn and sits on the
critical path, so a degraded classifier must fail open fast rather than stall the reply.

The mention handler (`keywordsBehaviorHandler`) is the only media-capable surface; `/summary` is
text-only.

### Attached images

The classifier is `text+image`, so the mention handler's **pre-screen** sends the user's attached
images alongside their caption (`moderateExchange(text, undefined, imageParts)`), reusing the
buffers `aiMedia` already downloaded — no second fetch. It screens the **sender's own** images,
whether the persona's model reads them as vision parts or they were collected only as
`generate_image` edit sources. `selectModerationImages` drops video/audio (the classifier takes
neither) and caps the count at `aiMedia`'s `MAX_IMAGES` — **never cap it lower**, or an extra
attachment becomes an unscreened gap.

Images from the *replied-to* message are **not** pre-screened, for the same reason `ownTurnText`
excludes quoted text — they are excluded from `moderationImageParts` while still flowing into
`mediaParts`/`imageEditParts`. What the model *says* about them is still caught by the output text
screen, and anything `generate_image` produces from them by `moderateGeneratedImages`.

Images ride the **inbound pass only**: they are a multi-MB base64 upload on the critical path under
a 15s timeout, and `Response Safety` turns on the assistant's text, not on a picture the inbound
pass already ruled on. If the model rejects the images (400/413/415/422 or an image/vision error)
the screen retries once text-only before failing open.

### Generated images and diagrams

The output pass screens the *prompts* the model passed to
`generate_image`/`generate_music`/`render_diagram` as part of the reply text. That is not the same as screening the picture, so `moderateGeneratedImages`
screens the returned bytes too, after the text pass and only on turns that actually generated an
image (≤ `IMAGE_GEN_DAILY_LIMIT` per user per day). `generatedImagePart` derives the MIME from the
filename `runImageGeneration` built out of the provider's own data URL, and returns null for anything
that isn't an image — `generate_music`'s WAV rides the same attachment list.

The bytes go in as the **user** turn (the only position the classifier accepts images in), so the
reply says `User Safety`, and `moderateGeneratedImages` re-attributes it to `flaggedSide:
'response'` — it is our output whatever the label says. **Don't "fix" that to `'user'`.**

A rendered diagram is a PNG on that same attachment list, so it is screened as a generated image —
which means the caption handed to `moderateGeneratedImages` **must** cover `render_diagram` too. It
did not until 2026-08-27: a diagram-only turn was judged against an empty caption, and a turn that
made both an image and a diagram judged the diagram under the *image's* prompt. A wrong caption is
worse than no caption here, because the cost of a false positive is a permanently paused session.

The words *inside* a diagram are a separate problem: the model chooses every label, and the reply
text does not contain them, so `Response Safety` over the reply alone never sees them. `generateContent`
therefore returns `screeningText` — `extractDiagramText` (`utils/diagramGen.ts`) run over the
untruncated markup — which the handler folds into the output text screen. It is captured inside the
tool loop because `redactToolCallArgs` cuts the recorded `source` to 500 chars for the audit row;
screening `toolCalls[].args.source` would screen a truncated prefix, the exact failure `chunkText`
exists to avoid. The extract is capped at 4000 chars so it cannot turn one screening call into
three on the critical path.

### Known limits

- **Video and audio are not screened.** The classifier takes text and images only, so an attached
  video or voice message reaches a media-capable persona unscreened, and the WAV from
  `generate_music` goes out unscreened (only its prompt and title are).
- **A post-screen trip still costs credits** on every surface — generation has already happened by
  then. The pre-screen exists to make that the uncommon case.
- **Only the user's own text, images and PDF attachments are screened for the pause decision**
  (`ownTurnText`, which now prefixes the extracted PDF text) — not the quoted reply context or its
  attached images. Screening *those* would let someone permanently pause a third party's session
  just by being quoted at. Content induced *by* quoted context is still caught by the output screen.
- **The full text is screened, not a truncated prefix.** `chunkText` splits input and output into
  `MAX_SCREENED_CHARS`-sized chunks and `moderateExchange` screens each one, so content past the
  first 8,000 chars can't slip through to the provider or into the delivered reply. Long inputs
  (e.g. a `/summary` of hundreds of messages) therefore cost one classifier call per chunk.

## Consent gate

Every path that can send a member's text to a provider is gated on a one-time acknowledgement:
`ensureAiConsent(db, userId, send)` (`utils/aiConsent.ts`), backed by the `AiConsent` table
(`db.aiConsent`). Wired into `keywordsBehaviorHandler` (before PDFs or attachments are even
downloaded) and both `/summary` subcommands. **A new AI entry point must call it too.**

- Returns false on decline, timeout, or DB failure — **fail closed**, and the caller must then stay
  silent, because the gate has already put the explanation on screen.
- `AI_CONSENT_VERSION` is stored per acceptance; bump it when the notice changes what is being
  agreed to and everyone is re-prompted. Cosmetic edits don't need a bump.
- Acceptances are cached in a Map inside `AiConsentModel` — the gate is on the hot path of every
  message that mentions Marv. Nothing is cached without a committed row behind it.
- `/ai forget` (`commands/ai_forget.ts` → `db.aiConsent.revoke`) withdraws consent and re-prompts
  next time. It touches consent only — stored conversations are `/ai chatdelete`'s job.
