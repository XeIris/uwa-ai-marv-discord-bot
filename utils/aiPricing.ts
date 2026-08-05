/**
 * Credit pricing for AI rate limits (issue #211).
 *
 * Rate limits are metered in CREDITS, not raw tokens: each model has an
 * input/output multiplier where $0.28 per million tokens = 1x, so expensive
 * models drain a user's budget faster and cheap models (DeepSeek, MiMo) get
 * roughly double the headroom of the old flat token counter.
 *
 *   credits = (prompt_tokens × mult_in) + (completion_tokens × mult_out)
 *
 * The AiUsage audit log also stores the derived USD cost (credits × $0.28/M)
 * per call in its `cost` column.
 */

/** $ per million tokens that defines the 1x multiplier. */
export const CREDIT_BASE_USD_PER_MILLION = 0.28;

interface ModelMultipliers {
  input: number;
  output: number;
}

// Multipliers per live OpenRouter pricing ($0.28/M = 1x). Models not listed here
// bill at 1x/1x (identical to the old raw-token accounting).
const MODEL_MULTIPLIERS: Record<string, ModelMultipliers> = {
  // $0.14/M in, $0.28/M out
  'deepseek/deepseek-v4-flash-0731': { input: 0.5, output: 1 },
  // $0.14/M in, $0.28/M out
  'xiaomi/mimo-v2.5': { input: 0.5, output: 1 },
  // $2/M in, $6/M out
  'x-ai/grok-4.5': { input: 7, output: 21.43 },
  // $0.20/M in, $1.2/M out. OpenRouter currently lists a further 50% off; that's
  // treated as a temporary promo and deliberately NOT priced in here.
  'openai/gpt-5.6-luna': { input: 0.72, output: 4.3 },
  // $0.03/M in, $0.13/M out
  'qwen/qwen3.7-flash': { input: 0.11, output: 0.46 },
  // Free tier — costs nothing, so it charges nothing (see FREE_MODELS).
  'openrouter/free': { input: 0, output: 0 },
};

/**
 * Models that are free to run. They bill 0 credits AND skip the rate-limit
 * reservation entirely (see generateContent), so a user who has exhausted
 * their paid budget can still talk to them.
 */
const FREE_MODELS = new Set<string>(['openrouter/free']);

export function isFreeModel(model: string): boolean {
  return FREE_MODELS.has(model);
}

const DEFAULT_MULTIPLIERS: ModelMultipliers = { input: 1, output: 1 };

/**
 * Flat completion-side allowance for in-flight rate-limit reservations (see
 * AiUsageModel.tryReserve). Actual usage is recorded from the provider's real
 * usage fields — the estimate only bounds how many concurrent requests can be
 * in flight before the limit bites.
 */
export const ESTIMATED_COMPLETION_TOKENS = 4096;

function getModelMultipliers(model: string): ModelMultipliers {
  return MODEL_MULTIPLIERS[model] ?? DEFAULT_MULTIPLIERS;
}

/** Credits charged for a call. Fractional — callers round as needed. */
export function creditsForTokens(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const mult = getModelMultipliers(model);
  return promptTokens * mult.input + completionTokens * mult.output;
}

/** USD cost derived from the same multipliers (credits × $0.28 per 1M). */
export function usdCostForTokens(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  return (creditsForTokens(model, promptTokens, completionTokens)
    * CREDIT_BASE_USD_PER_MILLION) / 1_000_000;
}
