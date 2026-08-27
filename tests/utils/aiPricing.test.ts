import { describe, test, expect } from 'bun:test';
import {
  creditsForTokens,
  usdCostForTokens,
  creditsForImages,
  usdCostForImages,
  CREDIT_BASE_USD_PER_MILLION,
  IMAGE_CREDIT_MULTIPLIER,
} from '../../utils/aiPricing';

describe('creditsForTokens', () => {
  test('bills unknown models at 1x/1x (legacy raw-token behavior)', () => {
    expect(creditsForTokens('some/unknown-model', 1000, 500)).toBe(1500);
  });

  test('bills deepseek-v4-flash at 0.29x in / 0.64x out ($0.08/M in, $0.18/M out)', () => {
    expect(creditsForTokens('deepseek/deepseek-v4-flash-0731', 100000, 50000)).toBeCloseTo(61000, 6);
  });

  test('bills mimo-v2.5 at 0.5x in / 1x out', () => {
    expect(creditsForTokens('xiaomi/mimo-v2.5', 100000, 50000)).toBe(100000);
  });

  test('bills grok-4.5 at 7x in / 21.43x out ($2/M in, $6/M out)', () => {
    expect(creditsForTokens('x-ai/grok-4.5', 10000, 10000)).toBe(284300);
  });

  test('bills gpt-5.6-luna at 0.72x in / 4.3x out ($0.20/M in, $1.2/M out)', () => {
    expect(creditsForTokens('openai/gpt-5.6-luna', 10000, 10000)).toBe(50200);
  });

  test('bills qwen3.7-flash at 0.11x in / 0.46x out ($0.03/M in, $0.13/M out)', () => {
    expect(creditsForTokens('qwen/qwen3.7-flash', 10000, 10000)).toBeCloseTo(5700, 6);
  });

  test('free models cost nothing', () => {
    expect(creditsForTokens('openrouter/free', 1_000_000, 1_000_000)).toBe(0);
  });
});

describe('usdCostForTokens', () => {
  test('derives USD from credits at the $0.28/M base rate', () => {
    // 1M in @0.29x + 1M out @0.64x = 0.93M credits → $0.2604
    expect(usdCostForTokens('deepseek/deepseek-v4-flash-0731', 1_000_000, 1_000_000))
      .toBeCloseTo(0.93 * CREDIT_BASE_USD_PER_MILLION, 10);
  });

  test('1x model: 1M tokens costs exactly the base rate', () => {
    expect(usdCostForTokens('unknown/model', 1_000_000, 0))
      .toBeCloseTo(CREDIT_BASE_USD_PER_MILLION, 10);
  });
});

describe('image pricing', () => {
  test('unpriced image models bill nothing', () => {
    expect(usdCostForImages('some/unknown-image-model')).toBe(0);
    expect(creditsForImages('some/unknown-image-model')).toBe(0);
  });

  test('muse-image lists at $0.01/image', () => {
    expect(usdCostForImages('meta/muse-image')).toBeCloseTo(0.01, 10);
    expect(usdCostForImages('meta/muse-image', 3)).toBeCloseTo(0.03, 10);
  });

  test('credits apply the surcharge on top of list price', () => {
    // $0.01 at $0.28/M = 35,714 credits, x1.5 = 53,571.
    expect(creditsForImages('meta/muse-image'))
      .toBeCloseTo((0.01 / CREDIT_BASE_USD_PER_MILLION) * 1_000_000 * IMAGE_CREDIT_MULTIPLIER, 6);
    expect(Math.round(creditsForImages('meta/muse-image'))).toBe(53571);
  });

  test('the gemini fallback image model is priced too', () => {
    expect(Math.round(creditsForImages('google/gemini-3.1-flash-lite-image'))).toBe(180161);
  });

  test('image counts are validated, not trusted', () => {
    expect(creditsForImages('meta/muse-image', -3)).toBe(0);
    expect(creditsForImages('meta/muse-image', Number.NaN)).toBe(0);
    expect(usdCostForImages('meta/muse-image', 2.9)).toBeCloseTo(0.02, 10);
  });
});
