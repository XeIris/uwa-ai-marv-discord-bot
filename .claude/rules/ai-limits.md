---
paths:
  - "utils/ai.ts"
  - "utils/aiPricing.ts"
  - "utils/llmRetry.ts"
  - "commands/ai*.ts"
  - "database/models/AiUsageModel.ts"
---

# AI usage limits & retry

`utils/ai.ts`, `utils/aiPricing.ts`, `AiUsageModel`.

Per-user fixed windows (`DAILY_LIMIT` / `WEEKLY_LIMIT` in `utils/ai.ts`) metered in **credits**, not
raw tokens:

```text
credits = tok_in × mult_in + tok_out × mult_out
```

where $0.28/M = 1x. **The per-model multiplier table lives in `utils/aiPricing.ts` — read it there,
it moves.** Two rules that don't move: unlisted models are 1x/1x, and listed promotional discounts
are ignored (multipliers track list price).

Models in `FREE_MODELS` (`openrouter/free`, the `@fr` persona) are 0x/0x **and** skip the
reservation entirely — free to run, so never metered or blocked.

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
