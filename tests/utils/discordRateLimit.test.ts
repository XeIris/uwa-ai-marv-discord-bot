import {
  describe, test, expect, beforeAll, afterAll, beforeEach,
} from 'bun:test';
import Database from '../../database/Database';
import { getRateLimitErrorMessage } from '../../utils/discordRateLimit';
import { AiRateLimitError, WEEKLY_LIMIT } from '../../utils/ai';

describe('discordRateLimit & AiRateLimitError', () => {
  let db: Database;

  beforeAll(async () => {
    const timestamp = Date.now();
    db = new Database(`./tests/temp/testRateLimitMsg-${timestamp}.db`);
    await db.ready;
  });

  afterAll(() => {
    db.db.close();
  });

  beforeEach(async () => {
    await db.executeQuery('DELETE FROM AiUsage');
    await db.executeQuery('DELETE FROM AiRateLimitWindow');
    await db.executeQuery('DELETE FROM User');
  });

  test('AiRateLimitError sets reason, reservedCredits, and remainingCredits correctly', () => {
    const err = new AiRateLimitError('daily', 89527, 87126);
    expect(err.message).toBe('RATE_LIMIT_EXCEEDED');
    expect(err.reason).toBe('daily');
    expect(err.reservedCredits).toBe(89527);
    expect(err.remainingCredits).toBe(87126);
  });

  test('getRateLimitErrorMessage includes reservation details when effective remaining capacity is provided', async () => {
    // Add 162,874 recorded daily usage out of 250,000
    await db.aiUsage.addUsage('u1', 'test-model', 162874, 0);

    const msg = await getRateLimitErrorMessage('u1', db, {
      reason: 'daily',
      reservedCredits: 89527,
      remainingCredits: 87126,
    });

    expect(msg).toContain('Daily AI Rate Limit Reached');
    expect(msg).toContain('162,874');
    expect(msg).toContain('250,000');
    expect(msg).toContain('requires ~**89,527** estimated credits');
    expect(msg).toContain('exceeds your remaining **87,126** credits');
  });

  test('getRateLimitErrorMessage omits comparison note when remainingCredits capacity is unavailable', async () => {
    await db.aiUsage.addUsage('u1', 'test-model', 162874, 0);

    // Omit remainingCredits: detailNote should be omitted rather than showing DB-only credits
    const msg = await getRateLimitErrorMessage('u1', db, {
      reason: 'daily',
      reservedCredits: 89527,
    });

    expect(msg).toContain('Daily AI Rate Limit Reached');
    expect(msg).not.toContain('estimated credits');
  });

  test('getRateLimitErrorMessage fallback selects window closer to capacity when DB total < limit', async () => {
    // Daily is at 65% (162,874 / 250,000), Weekly is at 43% (428,469 / 1,000,000)
    await db.aiUsage.addUsage('u1', 'test-model', 162874, 0);

    // Explicitly set weekly window to 428,469
    await db.executeQuery(
      'UPDATE AiRateLimitWindow SET tokens = 428469 WHERE user_id = ? AND window_type = ?',
      ['u1', 'weekly'],
    );

    // Omit explicit reason: fallback should pick 'daily' because 65% > 43%
    const msg = await getRateLimitErrorMessage('u1', db);
    expect(msg).toContain('Daily AI Rate Limit Reached');
    expect(msg).not.toContain('Weekly AI Rate Limit Reached');
  });

  test('getRateLimitErrorMessage correctly identifies weekly limit when weekly >= WEEKLY_LIMIT', async () => {
    // Set weekly window to WEEKLY_LIMIT while daily remains 0
    await db.executeQuery(
      "INSERT INTO AiRateLimitWindow (user_id, window_type, window_start, tokens) VALUES (?, 'weekly', datetime('now'), ?)",
      ['u1', WEEKLY_LIMIT],
    );

    const msg = await getRateLimitErrorMessage('u1', db);
    expect(msg).toContain('Weekly AI Rate Limit Reached');
  });
});
