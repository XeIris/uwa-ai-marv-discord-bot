// Per-model EMA of (actual tokens / estimated tokens). Lets us correct the
// gpt-tokenizer (cl100k_base) estimate against the real prompt_tokens each
// provider reports, since nemotron/grok/etc. use different BPE vocabs.

const EMA_ALPHA = 0.2;
const MIN_SAMPLE_TOKENS = 200;

const multipliers = new Map<string, number>();

function recordUsage(model: string, estimatedTokens: number, actualTokens: number): void {
  if (estimatedTokens < MIN_SAMPLE_TOKENS || actualTokens < MIN_SAMPLE_TOKENS) return;
  const ratio = actualTokens / estimatedTokens;
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const prev = multipliers.get(model) ?? 1.0;
  multipliers.set(model, prev * (1 - EMA_ALPHA) + ratio * EMA_ALPHA);
}

function getCalibrationMultiplier(model: string): number {
  const m = multipliers.get(model) ?? 1.0;
  // Only ever *shrink* the budget, never grow it. If the tokenizer overcounts
  // (ratio < 1), keep the conservative 1.0 so we don't risk overflowing.
  return Math.max(1.0, m);
}

export { recordUsage, getCalibrationMultiplier };
