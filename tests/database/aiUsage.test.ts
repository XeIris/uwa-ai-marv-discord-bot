import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';
import { creditsForImages, usdCostForImages } from '../../utils/aiPricing';

const USER = 'u1';
const IMAGE_MODEL = 'meta/muse-image';

describe('AiUsageModel image metering', () => {
  let db: Database;

  beforeAll(async () => {
    db = new Database(`./tests/temp/testAiUsage-${Date.now()}.db`);
    await db.ready;
  });

  afterAll(() => { db.db.close(); });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM AiUsage');
    await db.executeQuery('DELETE FROM AiRateLimitWindow');
  });

  test('an image draws on the same daily window as chat', async () => {
    expect(await db.aiUsage.getDailyUsage(USER)).toBe(0);

    await db.aiUsage.addImageUsage(USER, IMAGE_MODEL, 1);

    const expected = Math.round(creditsForImages(IMAGE_MODEL, 1));
    expect(await db.aiUsage.getDailyUsage(USER)).toBe(expected);
    expect(await db.aiUsage.getWeeklyUsage(USER)).toBe(expected);
  });

  test('the audit row logs zero tokens and the true list cost', async () => {
    await db.aiUsage.addImageUsage(USER, IMAGE_MODEL, 1);

    const rows = await db.executeSelectAllQuery('SELECT * FROM AiUsage WHERE user_id = ?', [USER]);
    expect(rows.length).toBe(1);
    expect(rows[0].tokensPrompt).toBe(0);
    expect(rows[0].tokensCompletion).toBe(0);
    // cost is real money (no surcharge); the window carries the surcharge.
    expect(rows[0].cost).toBeCloseTo(usdCostForImages(IMAGE_MODEL, 1), 10);
    expect(rows[0].cost).toBeLessThan(
      (creditsForImages(IMAGE_MODEL, 1) * 0.28) / 1_000_000,
    );
  });

  test('image and chat usage accumulate in the same window', async () => {
    await db.aiUsage.addUsage(USER, 'deepseek/deepseek-v4-flash-0731', 10_000, 10_000);
    const afterChat = await db.aiUsage.getDailyUsage(USER);
    expect(afterChat).toBeGreaterThan(0);

    await db.aiUsage.addImageUsage(USER, IMAGE_MODEL, 1);
    expect(await db.aiUsage.getDailyUsage(USER))
      .toBe(afterChat + Math.round(creditsForImages(IMAGE_MODEL, 1)));
  });

  test('an unpriced image model bills nothing but still logs', async () => {
    await db.aiUsage.addImageUsage(USER, 'some/unpriced-image-model', 1);

    expect(await db.aiUsage.getDailyUsage(USER)).toBe(0);
    const rows = await db.executeSelectAllQuery('SELECT * FROM AiUsage WHERE user_id = ?', [USER]);
    expect(rows.length).toBe(1);
  });

  test('a reservation the size of an image blocks once the budget is gone', async () => {
    const credits = creditsForImages(IMAGE_MODEL, 1);
    // Five images is more than the 250k daily budget allows.
    for (let i = 0; i < 5; i += 1) {
      await db.aiUsage.addImageUsage(USER, IMAGE_MODEL, 1);
    }

    const gate = db.aiUsage.tryReserve(USER, credits);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('daily');
  });
});
