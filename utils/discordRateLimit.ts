import type { ChatInputCommandInteraction } from 'discord.js';
import type Database from '../database/Database';
import { DAILY_LIMIT, WEEKLY_LIMIT } from './ai';

/**
 * Renders a rate-limit reset time as a Discord short-time + relative stamp,
 * e.g. "3:04 PM (in about 2 hours)" — resolved to each viewer's local clock.
 */
export function formatResetTimestamp(resetAt: Date): string {
  const unix = Math.floor(resetAt.getTime() / 1000);
  return `<t:${unix}:t> (<t:${unix}:R>)`;
}

/**
 * The trailing "**Resets:** <t…>" embed line for a rate-limited user (empty
 * string when not limited or the window has already lapsed). Shared by the
 * `/ai usage` and `/profile` embeds so the wording stays in sync.
 */
export async function getResetLine(
  db: Database,
  userId: string,
  status: { limited: boolean; reason?: 'daily' | 'weekly' },
): Promise<string> {
  if (!status.limited || !status.reason) return '';
  const resetAt = await db.aiUsage.getResetAt(userId, status.reason);
  return resetAt ? `\n**Resets:** ${formatResetTimestamp(resetAt)}` : '';
}

/**
 * "Resets:" value for one window, shown whether or not the user is limited so
 * they can watch the countdown. A fixed window only exists once it has been
 * opened by a first charged request, hence the "Not yet started" wording.
 */
export async function getWindowResetLabel(
  db: Database,
  userId: string,
  window: 'daily' | 'weekly',
): Promise<string> {
  const resetAt = await db.aiUsage.getResetAt(userId, window);
  return resetAt ? formatResetTimestamp(resetAt) : 'Not yet started (no usage in this window)';
}

export interface RateLimitOptions {
  reason?: 'daily' | 'weekly';
  reservedCredits?: number;
  remainingCredits?: number;
}

export async function getRateLimitErrorMessage(
  userId: string,
  db: Database,
  opts?: RateLimitOptions,
): Promise<string> {
  const [dailyUsage, weeklyUsage] = await Promise.all([
    db.aiUsage.getDailyUsage(userId),
    db.aiUsage.getWeeklyUsage(userId),
  ]);

  let reason: 'daily' | 'weekly';
  if (opts?.reason === 'daily' || opts?.reason === 'weekly') {
    reason = opts.reason;
  } else if (dailyUsage >= DAILY_LIMIT) {
    reason = 'daily';
  } else if (weeklyUsage >= WEEKLY_LIMIT) {
    reason = 'weekly';
  } else {
    // Neither recorded DB total alone reaches the limit (e.g. pre-flight reservation
    // pushed usage over). Pick the window closer to its capacity limit.
    const dailyRatio = dailyUsage / DAILY_LIMIT;
    const weeklyRatio = weeklyUsage / WEEKLY_LIMIT;
    reason = dailyRatio >= weeklyRatio ? 'daily' : 'weekly';
  }

  const isDaily = reason === 'daily';
  const limitLabel = isDaily ? 'Daily' : 'Weekly';
  const usageVal = isDaily ? dailyUsage : weeklyUsage;
  const limitVal = isDaily ? DAILY_LIMIT : WEEKLY_LIMIT;
  const windowLabel = isDaily ? '24-hour' : '7-day';

  const resetAt = await db.aiUsage.getResetAt(userId, reason);
  const resetNote = resetAt
    ? `Your limit resets ${formatResetTimestamp(resetAt)}.`
    : 'Please wait for your limit to reset.';

  let detailNote = '';
  if (typeof opts?.reservedCredits === 'number' && opts.reservedCredits > 0 && usageVal < limitVal) {
    if (typeof opts.remainingCredits === 'number') {
      const remaining = Math.max(0, opts.remainingCredits);
      detailNote = `\nThis request requires ~**${opts.reservedCredits.toLocaleString()}** estimated credits, which exceeds your remaining **${remaining.toLocaleString()}** credits for this window.`;
    }
  }

  return `⚠️ **${limitLabel} AI Rate Limit Reached**\nYou've used **${usageVal.toLocaleString()}** / **${limitVal.toLocaleString()}** credits in the current ${windowLabel} window.${detailNote}\n${resetNote}`;
}

export async function handleRateLimitError(
  interaction: ChatInputCommandInteraction,
  db: Database,
  opts?: RateLimitOptions,
): Promise<void> {
  const content = await getRateLimitErrorMessage(interaction.user.id, db, opts);
  await interaction.editReply({
    content,
  });
}
