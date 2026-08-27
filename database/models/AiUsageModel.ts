import type Database from '../Database';
import aiUsageQueries from '../queries/aiUsageQueries';
import { DAILY_LIMIT, WEEKLY_LIMIT } from '../../utils/ai';
import {
  creditsForImages, creditsForTokens, usdCostForImages, usdCostForTokens,
} from '../../utils/aiPricing';

type WindowType = 'daily' | 'weekly';

/** SQLite datetime modifiers per window: `pos` extends a window, `neg` tests if it's still open. */
const WINDOW_INTERVALS: Record<WindowType, { pos: string; neg: string }> = {
  daily: { pos: '+1 day', neg: '-1 day' },
  weekly: { pos: '+7 days', neg: '-7 days' },
};

/**
 * Rate limits are metered in credits (see utils/aiPricing.ts), not raw tokens:
 * the fixed windows accumulate `creditsForTokens(model, in, out)` rounded to an
 * integer per call, so a cheap model gets more headroom than an expensive one.
 * The AiUsage audit log keeps the raw per-call token counts plus the derived
 * USD cost.
 */
class AiUsageModel {
  private db: Database;

  /**
   * In-flight credits per user (generations started but not yet recorded).
   * Single-process bot, so an in-memory map suffices: it lets tryReserve count
   * concurrent in-progress requests toward the limit, closing the check-then-act
   * race where a spammed burst all passed isRateLimited before any usage was
   * recorded (issue #213). Entries always return to 0 via release() in a
   * finally block, so a crash never strands a reservation.
   */
  private pending = new Map<string, number>();

  constructor(db: Database) {
    this.db = db;
  }

  async addUsage(
    userId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void> {
    const credits = Math.round(creditsForTokens(model, promptTokens, completionTokens));
    const usdCost = usdCostForTokens(model, promptTokens, completionTokens);
    await this.record(userId, model, promptTokens, completionTokens, credits, usdCost);
  }

  /**
   * Records `images` generated images against the same daily/weekly windows as
   * chat. Image models are billed per image, not per token, so the audit row
   * logs zero tokens and the true list cost — AiUsage.cost stays a real-money
   * ledger — while the windows carry the IMAGE_CREDIT_MULTIPLIER surcharge.
   */
  async addImageUsage(userId: string, model: string, images = 1): Promise<void> {
    const credits = Math.round(creditsForImages(model, images));
    const usdCost = usdCostForImages(model, images);
    await this.record(userId, model, 0, 0, credits, usdCost);
  }

  /** Logs the call (audit) and folds its credits into both fixed windows atomically. */
  private async record(
    userId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    credits: number,
    usdCost: number,
  ): Promise<void> {
    await this.db.executeTransaction((rawDb) => {
      const logResult = rawDb.query(aiUsageQueries.ADD_USAGE)
        .run(userId, model, promptTokens, completionTokens, usdCost);
      if (!logResult || logResult.changes === 0) {
        throw new Error('Failed to record AI usage in the database');
      }
      (Object.keys(WINDOW_INTERVALS) as WindowType[]).forEach((type) => {
        const { pos } = WINDOW_INTERVALS[type];
        rawDb.query(aiUsageQueries.UPSERT_WINDOW).run(userId, type, credits, pos, pos);
      });
    });
  }

  /** Credits used in the current fixed window (0 once it has lapsed) and when it resets. */
  private async getWindow(userId: string, type: WindowType): Promise<{ tokens: number; resetAt: Date | null }> {
    const { pos, neg } = WINDOW_INTERVALS[type];
    const row = await this.db.executeSelectQuery(aiUsageQueries.GET_WINDOW, [neg, neg, pos, userId, type]);
    const tokens = typeof row?.tokens === 'number' ? row.tokens : 0;

    let resetAt: Date | null = null;
    if (row?.resetAt) {
      // SQLite datetime() returns UTC "YYYY-MM-DD HH:MM:SS"; make it ISO-parseable.
      const date = new Date(`${String(row.resetAt).replace(' ', 'T')}Z`);
      if (!Number.isNaN(date.getTime())) resetAt = date;
    }
    return { tokens, resetAt };
  }

  /** Synchronous window read for tryReserve (bun:sqlite is sync under the hood). */
  private getWindowTokensSync(userId: string, type: WindowType): number {
    const { pos, neg } = WINDOW_INTERVALS[type];
    const row = this.db.db.query(aiUsageQueries.GET_WINDOW).get(neg, neg, pos, userId, type) as any;
    return typeof row?.tokens === 'number' ? row.tokens : 0;
  }

  async getDailyUsage(userId: string): Promise<number> {
    return (await this.getWindow(userId, 'daily')).tokens;
  }

  async getWeeklyUsage(userId: string): Promise<number> {
    return (await this.getWindow(userId, 'weekly')).tokens;
  }

  /**
   * When the given fixed window resets (its start + interval), or `null` when no
   * window is currently open. Under a fixed window a rate-limited user stays
   * limited until exactly this instant, when the counter clears wholesale.
   */
  async getResetAt(userId: string, reason: WindowType): Promise<Date | null> {
    return (await this.getWindow(userId, reason)).resetAt;
  }

  async checkRateLimit(userId: string): Promise<{
    limited: boolean;
    reason?: WindowType;
    usage?: number;
    limit?: number;
  }> {
    const dailyUsage = await this.getDailyUsage(userId);
    if (dailyUsage >= DAILY_LIMIT) {
      return {
        limited: true, reason: 'daily', usage: dailyUsage, limit: DAILY_LIMIT,
      };
    }

    const weeklyUsage = await this.getWeeklyUsage(userId);
    if (weeklyUsage >= WEEKLY_LIMIT) {
      return {
        limited: true, reason: 'weekly', usage: weeklyUsage, limit: WEEKLY_LIMIT,
      };
    }

    return { limited: false };
  }

  async isRateLimited(userId: string): Promise<boolean> {
    const status = await this.checkRateLimit(userId);
    return status.limited;
  }

  /**
   * Atomically reserve estimated credits for a generation that is ABOUT to run.
   * The check counts both recorded usage and other in-flight reservations, so a
   * burst of concurrent requests can't all slip past the limit before any of
   * them records usage. Fully synchronous (no awaits) — atomic in this
   * single-threaded process. On success the caller MUST later call release()
   * with the same amount (in a finally), and record real usage via addUsage().
   * Everyone is metered — devs included (there is no bypass).
   */
  tryReserve(userId: string, estimatedCredits: number): {
    ok: boolean;
    reason?: WindowType;
    remaining?: number;
  } {
    const amount = Math.max(0, Math.round(estimatedCredits));
    const inFlight = this.pending.get(userId) ?? 0;

    const dailyTokens = this.getWindowTokensSync(userId, 'daily');
    if (dailyTokens + inFlight + amount > DAILY_LIMIT) {
      const remaining = Math.max(0, DAILY_LIMIT - (dailyTokens + inFlight));
      return { ok: false, reason: 'daily', remaining };
    }

    const weeklyTokens = this.getWindowTokensSync(userId, 'weekly');
    if (weeklyTokens + inFlight + amount > WEEKLY_LIMIT) {
      const remaining = Math.max(0, WEEKLY_LIMIT - (weeklyTokens + inFlight));
      return { ok: false, reason: 'weekly', remaining };
    }

    this.pending.set(userId, inFlight + amount);
    return { ok: true };
  }

  /** Returns a reservation made by tryReserve. Safe against over-release. */
  release(userId: string, estimatedCredits: number): void {
    const inFlight = this.pending.get(userId);
    if (inFlight === undefined) return;
    const remaining = inFlight - Math.max(0, Math.round(estimatedCredits));
    if (remaining > 0) this.pending.set(userId, remaining);
    else this.pending.delete(userId);
  }

  /** In-flight reserved credits for a user (diagnostics/tests). */
  getPendingCredits(userId: string): number {
    return this.pending.get(userId) ?? 0;
  }
}

export default AiUsageModel;
