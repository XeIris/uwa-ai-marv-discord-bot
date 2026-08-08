import { EmbedBuilder } from 'discord.js';
import { log, logError } from '../utils/log';
import { loadResolvedServerConfig } from '../utils/serverConfig';
import { discordTimestamp } from '../utils/perthTime';
import { resolveAndPrune } from '../utils/eventImage';
import type { EventEntry, ReminderKind } from '../database/models/EventModel';

/**
 * Posts automatic reminders for upcoming events.
 *
 * **Reminders are off unless a server opts in** by setting the
 * `event_reminder_channels` channel list (`/serverconfig setchannel`). With no
 * channel configured the tick is a no-op — it does not DM anyone, and it does not
 * fall back to a "general" channel. The skip is logged once per guild, not once
 * per tick, so an unconfigured server doesn't fill the log.
 *
 * Duplicate suppression lives in the DB, not in memory: each event carries a
 * `reminder_day_sent_at` / `reminder_soon_sent_at` marker, and the UPDATE that
 * sets it is conditional on it still being NULL. That claim-then-post ordering
 * means a restart mid-sweep, or two overlapping ticks, cannot double-post. It
 * also means a reminder that fails to send is not retried — deliberate, since the
 * alternative is a bot that spams an event it already announced.
 *
 * Events that already started are never announced: the window is
 * `now < starts_at <= now + window`, so a bot that was offline for a day comes
 * back quiet rather than announcing yesterday.
 */

const TICK_INTERVAL_MS = 5 * 60 * 1000;
/** How soon before an event each reminder fires. */
const WINDOWS: Record<ReminderKind, { ms: number; label: string; colour: `#${string}` }> = {
  day: { ms: 24 * 60 * 60 * 1000, label: 'tomorrow', colour: '#5865F2' },
  soon: { ms: 60 * 60 * 1000, label: 'starting soon', colour: '#57F287' },
};
const MAX_EVENTS_PER_TICK = 20;

export class EventScheduler {
  private client: any;

  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  /** Guilds already logged as having no reminder channel, so we say it once. */
  private warnedGuilds = new Set<string>();

  constructor(client: any) {
    this.client = client;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => logError('[events] reminder tick failed:', err));
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
    log(`[events] reminder scheduler started (every ${TICK_INTERVAL_MS / 60000}m)`);
    // Don't sweep immediately on boot — give the client time to be ready.
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    log('[events] reminder scheduler stopped');
  }

  /** One sweep over both reminder windows. Public for tests. */
  async tick(now: Date = new Date()): Promise<void> {
    // Ticks are 5 minutes apart but a sweep is I/O bound; never overlap them.
    if (this.running) return;
    this.running = true;
    try {
      for (const kind of Object.keys(WINDOWS) as ReminderKind[]) {
        // eslint-disable-next-line no-await-in-loop
        await this.sweep(kind, now);
      }
    } finally {
      this.running = false;
    }
  }

  private async sweep(kind: ReminderKind, now: Date): Promise<void> {
    let due: EventEntry[];
    try {
      due = await this.client.db.event.listDueReminders(kind, WINDOWS[kind].ms, MAX_EVENTS_PER_TICK, now);
    } catch (err) {
      logError(`[events] failed to list due ${kind} reminders:`, err);
      return;
    }
    if (due.length === 0) return;

    for (const event of due) {
      // eslint-disable-next-line no-await-in-loop
      await this.remind(kind, event, now);
    }
  }

  private async remind(kind: ReminderKind, event: EventEntry, now: Date): Promise<void> {
    let channelIds: string[];
    try {
      const config = await loadResolvedServerConfig(this.client.db, event.serverId);
      channelIds = config.eventReminderChannelIds;
    } catch (err) {
      logError(`[events] failed to read config for guild ${event.serverId}:`, err);
      return;
    }

    if (channelIds.length === 0) {
      if (!this.warnedGuilds.has(event.serverId)) {
        this.warnedGuilds.add(event.serverId);
        log(`[events] guild ${event.serverId} has upcoming events but no event_reminder_channels set — `
          + 'reminders are off for it (set with /serverconfig setchannel)');
      }
      // Leave the marker NULL: if they configure a channel before the event, the
      // next tick picks it up.
      return;
    }

    // Claim before posting. If another tick already took it, stop here.
    let claimed = false;
    try {
      claimed = await this.client.db.event.claimReminder(kind, event.id, now);
    } catch (err) {
      logError(`[events] failed to claim ${kind} reminder for event ${event.id}:`, err);
      return;
    }
    if (!claimed) return;

    const imageUrl = await resolveAndPrune(this.client, this.client.db, event).catch(() => null);
    const embed = this.buildEmbed(kind, event);
    if (imageUrl) embed.setImage(imageUrl);

    let delivered = 0;
    for (const channelId of channelIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const channel = await this.client.channels.fetch(channelId);
        if (!channel?.isTextBased?.()) {
          log(`[events] reminder channel ${channelId} in guild ${event.serverId} is not text-based; skipping`);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await channel.send({ embeds: [embed] });
        delivered += 1;
      } catch (err) {
        logError(`[events] failed to post ${kind} reminder for event ${event.id} to ${channelId}:`, err);
      }
    }

    log(`[events] posted ${kind} reminder for event ${event.id} ("${event.name}") to ${delivered}/${channelIds.length} channel(s)`);
  }

  private buildEmbed(kind: ReminderKind, event: EventEntry): EmbedBuilder {
    const when = `${discordTimestamp(event.startsAt)} (${discordTimestamp(event.startsAt, 'R')})`;
    const lines = [when];
    if (event.location) lines.push(`📍 ${event.location}`);
    if (event.description) lines.push('', event.description);
    if (event.url) lines.push('', event.url);

    return new EmbedBuilder()
      .setTitle(`${event.name} — ${WINDOWS[kind].label}`)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setColor(WINDOWS[kind].colour);
  }
}

export default EventScheduler;
