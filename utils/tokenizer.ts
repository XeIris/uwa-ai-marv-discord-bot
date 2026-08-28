// eslint-disable-next-line import-x/no-cycle -- see the note in utils/ai.ts
import { formatHistoryEntryForModel, formatMessageWithTimestamp } from './ai';
import { getCalibrationMultiplier } from './tokenCalibration';

// Cheap char-based estimate. ~10–20% off on English, worse on code/CJK, but
// per-model drift is corrected by tokenCalibration against usage.prompt_tokens.
// Trade vs. a real BPE tokenizer: tens of MB of resident heap saved.
function countTokensOpenRouter(text: string): number {
  return Math.ceil(text.length / 4);
}

function countTokensOpenRouterMessages(messages: { role: string; content: string }[]): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens overhead per message for role/formatting
    total += 4 + countTokensOpenRouter(msg.content);
  }
  return total;
}

// Provider-agnostic token counter for history
export interface TokenBudget {
  maxTokens: number;
  usedTokens: number;
  percentage: number;
}

export interface ContextWarning {
  level: 50 | 75 | 95;
  message: string;
  wasTrimmed: boolean;
  trimmedCount: number;
}

const CONTEXT_LIMITS: Record<string, number> = {
  // OpenRouter models
  // Calibration further narrows the effective budget based on real usage.
  'nvidia/nemotron-3-ultra-550b-a55b:free': 1_000_000,
  // Marv's model. The model actually serves ~1.3M, but the budget is capped here
  // deliberately: no Discord conversation comes near 128k, and a low cap only
  // costs trimmed history while a high one risks a 400 that costs the reply.
  'z-ai/glm-5.3-flash': 128_000,
  // Internal personas (Summarizer, TitleGen) and the config default. The slug
  // advertises 1M, but it runs on default routing across ~28 endpoints and the
  // smallest serve 256k — budget for the smallest one we can land on.
  'deepseek/deepseek-v4-flash-0731': 262_144,
  'xiaomi/mimo-v2-flash:nitro': 256_000,
  // 1M on the pinned Xiaomi endpoint; media (base64 parts) is not counted by
  // the tokenizer, so leave the standard reserve headroom to absorb it.
  'xiaomi/mimo-v2.5': 1_000_000,
  'x-ai/grok-4.5': 500_000,
  // Default for unknown models
  default: 128_000,
};

function getContextLimit(model: string): number {
  return CONTEXT_LIMITS[model] || CONTEXT_LIMITS.default;
}

// Reserve tokens for system prompt + new user message + response.
// When web search is enabled, bump the floor so up to ~3 tool-call payloads
// (~4k chars / ~1k tokens each) plus the final answer all fit.
function computeReservedTokens(contextSize: number, webSearchEnabled = false): number {
  // Clamp the floor to contextSize so tiny-context models (e.g. 8k image-gen)
  // don't reserve more tokens than they have, sending rawAvailable negative.
  const rawFloor = webSearchEnabled ? 12_288 : 1_024;
  const floor = Math.min(rawFloor, contextSize);
  return Math.min(16_384, Math.max(floor, Math.floor(contextSize * 0.1)));
}

/**
 * Trims history from the oldest messages to fit within the token budget.
 * Returns the trimmed history and context usage info.
 */
async function trimHistoryToFit(
  provider: string,
  model: string,
  systemPrompt: string,
  history: { role: string; message: string; timestamp?: string }[],
  newPrompt: string,
  webSearchEnabled = false,
): Promise<{ trimmedHistory: typeof history; budget: TokenBudget; warnings: ContextWarning[] }> {
  const requestTime = new Date();
  const stampedNewPrompt = formatMessageWithTimestamp(newPrompt, requestTime);
  const contextLimit = getContextLimit(model);
  const reserved = computeReservedTokens(contextLimit, webSearchEnabled);
  const rawAvailable = contextLimit - reserved;
  // Shrink budget by the calibrated drift factor for this model (openrouter only).
  const calibration = provider === 'openrouter' ? getCalibrationMultiplier(model) : 1.0;
  const availableForHistory = Math.floor(rawAvailable / calibration);

  const systemTokens = countTokensOpenRouter(systemPrompt) + 4;
  const promptTokens = countTokensOpenRouter(stampedNewPrompt) + 4;

  const fixedTokens = systemTokens + promptTokens;
  const budgetForHistory = Math.max(0, availableForHistory - fixedTokens);

  if (fixedTokens > availableForHistory) {
    throw new Error(
      `System prompt + user prompt (${fixedTokens.toLocaleString()} tokens) exceeds calibrated budget (${availableForHistory.toLocaleString()} tokens) for ${model} [${provider}]`,
    );
  }

  // Count tokens for each history message and trim from oldest
  const messageCosts = history.map(
    (msg) => countTokensOpenRouter(formatHistoryEntryForModel(msg)) + 4,
  );

  // Trim from the start (oldest) until we fit
  let totalHistoryTokens = messageCosts.reduce((a, b) => a + b, 0);
  let startIndex = 0;

  while (totalHistoryTokens > budgetForHistory && startIndex < history.length) {
    totalHistoryTokens -= messageCosts[startIndex];
    startIndex += 1;
  }

  const trimmedHistory = history.slice(startIndex);
  const usedTokens = fixedTokens + totalHistoryTokens;
  const percentage = Math.round(((usedTokens * calibration) / contextLimit) * 100);

  const warnings: ContextWarning[] = [];
  const wasTrimmed = startIndex > 0;
  const trimmedCount = startIndex;
  let warningLevel: 50 | 75 | 95 | null = null;
  if (percentage >= 95) warningLevel = 95;
  else if (percentage >= 75) warningLevel = 75;
  else if (percentage >= 50) warningLevel = 50;

  if (warningLevel) {
    const trimNote = wasTrimmed ? ` Trimmed ${trimmedCount} old message${trimmedCount === 1 ? '' : 's'}.` : '';
    warnings.push({
      level: warningLevel,
      message: `Context is **${percentage}%** full (${usedTokens.toLocaleString()}/${contextLimit.toLocaleString()} tokens).${trimNote}`,
      wasTrimmed,
      trimmedCount,
    });
  } else if (wasTrimmed) {
    warnings.push({
      level: 50,
      message: `Trimmed ${trimmedCount} old message${trimmedCount === 1 ? '' : 's'} to fit context (${usedTokens.toLocaleString()}/${contextLimit.toLocaleString()} tokens).`,
      wasTrimmed,
      trimmedCount,
    });
  }

  return {
    trimmedHistory,
    budget: { maxTokens: contextLimit, usedTokens, percentage },
    warnings,
  };
}

export {
  countTokensOpenRouter,
  countTokensOpenRouterMessages,
  getContextLimit,
  trimHistoryToFit,
};
