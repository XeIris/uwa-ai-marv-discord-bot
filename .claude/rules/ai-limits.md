---
paths:
  - "utils/ai.ts"
  - "utils/aiPricing.ts"
  - "utils/aiModeration.ts"
  - "utils/aiSessionLock.ts"
  - "utils/llmRetry.ts"
  - "utils/aiConsent.ts"
  - "commands/ai*.ts"
  - "commands/summary_*.ts"
  - "classes/handlers/keywordsBehaviorHandler.ts"
  - "database/models/AiUsageModel.ts"
  - "database/models/AiConsentModel.ts"
---

# AI usage limits, routing, moderation, consent & retry

`utils/ai.ts`, `utils/aiPricing.ts`, `AiUsageModel`.

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
advertised 1M: the cheap endpoints are the small-context ones.

`reasoning` / `visionReasoning` are the same idea for OpenRouter's `reasoning` body field. Marv's
text route sets `{ "enabled": false }`: DeepSeek V4 Flash otherwise spends ~150 reasoning tokens and
~18s on a one-line chat answer (measured; ~10s and 0 with it off) and bills them as completion
tokens, and tool calling is unaffected either way. The **music composing turn is exempt** — the
request builder skips the override once `musicGuideRead` is set, because working out an arrangement
is the one place thinking pays for itself.

**Credit multipliers were deliberately not retuned for the swap** — `aiPricing.ts` still bills
DeepSeek at 0.5x/1x, which is generous against what price-sorted routing actually costs. Real spend
is therefore *below* what `AiUsage.cost` records; that column is an upper bound, and it also ignores
provider-side prompt caching.

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

### Generated images

The output pass screens the *prompts* the model passed to `generate_image`/`generate_music` as part
of the reply text. That is not the same as screening the picture, so `moderateGeneratedImages`
screens the returned bytes too, after the text pass and only on turns that actually generated an
image (≤ `IMAGE_GEN_DAILY_LIMIT` per user per day). `generatedImagePart` derives the MIME from the
filename `runImageGeneration` built out of the provider's own data URL, and returns null for anything
that isn't an image — `generate_music`'s WAV rides the same attachment list.

The bytes go in as the **user** turn (the only position the classifier accepts images in), so the
reply says `User Safety`, and `moderateGeneratedImages` re-attributes it to `flaggedSide:
'response'` — it is our output whatever the label says. **Don't "fix" that to `'user'`.**

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
