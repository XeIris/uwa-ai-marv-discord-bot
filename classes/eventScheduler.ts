import { EmbedBuilder } from 'discord.js';
import { log, logError } from '../utils/log';
import { loadResolvedServerConfig, SERVER_CONFIG_KEYS } from '../utils/serverConfig';
import { discordTimestamp } from '../utils/perthTime';
import { resolveAndPrune } from '../utils/eventImage';
import type { EventEntry, ReminderKind } from '../database/models/EventModel';

/**
 * Posts automatic reminders for upcoming events.
 *
 * **Reminders are off unless a server opts in** by setting the
 * `event_reminder_channels` channel list (`/serverconfig setchannel`). That
 * filter lives in the SQL (see `LIST_DUE_REMINDERS`) rather than here, so
 * opted-out guilds cannot consume the LIMITed batch; nothing is DM'd and no
 * "general" channel is guessed.
 *
 * Duplicate suppression lives in the DB, not in memory: each event carries a
 * `reminder_day_sent_at` / `reminder_soon_sent_at` marker, and the UPDATE that
 * sets it is conditional on it still being NULL. That claim-then-post ordering
 * means a restart mid-sweep, or two overlapping ticks, cannot double-post. If
 * delivery then fails to *every* channel the claim is handed back so a later tick
 * retries; partial delivery keeps it, because re-posting to channels that already
 * received the reminder is worse than one channel missing out.
 *
 * Each reminder fires inside a lead-time **band** before the start time (see
 * WINDOWS), so the labels stay truthful and a delayed tick still catches the
 * event. Events that already started are never announced, so a bot that was
 * offline overnight comes back quiet rather than announcing yesterday.
 */

const TICK_INTERVAL_MS = 5 * 60 * 1000;
/**
 * A short first sweep delay rather than an immediate one. `login()` can resolve
 * before the constructor's un-awaited `init()` has finished `await db.ready`, so
 * sweeping instantly can hit the DB before the schema exists. 30s is far shorter
 * than the old five-minute wait (which silently skipped any event starting inside
 * the first interval after a restart) and comfortably after startup.
 */
const INITIAL_SWEEP_DELAY_MS = 30 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/**
 * Lead-time **band** per reminder, as (from, to) before the start time. A band,
 * not just an upper bound: with `to` alone the 24-hour sweep announced
 * "tomorrow" for an event two hours away. Each band is far wider than the tick
 * interval, so a delayed tick still catches the event.
 */
const WINDOWS: Record<ReminderKind, {
  fromMs: number; toMs: number; label: string; colour: `#${string}`;
}> = {
  day: {
    fromMs: 18 * HOUR_MS, toMs: 24 * HOUR_MS, label: 'tomorrow', colour: '#5865F2',
  },
  soon: {
    fromMs: 0, toMs: HOUR_MS, label: 'starting soon', colour: '#57F287',
  },
};
const MAX_EVENTS_PER_TICK = 20;

export class EventScheduler {
  private client: any;

  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  private initialSweep: ReturnType<typeof setTimeout> | null = null;

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
    // First sweep shortly after boot, so a restart doesn't skip an event that
    // starts inside the first interval.
    this.initialSweep = setTimeout(() => {
      this.initialSweep = null;
      this.tick().catch((err) => logError('[events] initial reminder sweep failed:', err));
    }, INITIAL_SWEEP_DELAY_MS);
    this.initialSweep.unref?.();
    log(`[events] reminder scheduler started (first sweep in ${INITIAL_SWEEP_DELAY_MS / 1000}s, `
      + `then every ${TICK_INTERVAL_MS / 60000}m)`);
  }

  stop(): void {
    if (this.initialSweep) {
      clearTimeout(this.initialSweep);
      this.initialSweep = null;
    }
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
      due = await this.client.db.event.listDueReminders(
        kind,
        WINDOWS[kind].fromMs,
        WINDOWS[kind].toMs,
        SERVER_CONFIG_KEYS.EVENT_REMINDER_CHANNELS,
        MAX_EVENTS_PER_TICK,
        now,
      );
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
      // The SQL excludes guilds with an empty setting, so reaching here means the
      // stored value was non-empty but held no usable snowflake — a malformed
      // config, not an opted-out guild.
      //
      // Consume the marker anyway. Leaving it NULL looks kinder (a fixed config
      // would then be picked up) but it puts the row back in every subsequent
      // batch, and a LIMITed batch of malformed rows starves guilds whose config
      // is fine. Losing one reminder for a guild whose setting is broken is the
      // better failure.
      if (!this.warnedGuilds.has(event.serverId)) {
        this.warnedGuilds.add(event.serverId);
        logError(`[events] guild ${event.serverId} has an event_reminder_channels value that contains no usable `
          + 'channel id — skipping its reminders (re-set it with /serverconfig setchannel)');
      }
      await this.client.db.event.claimReminder(kind, event.id, now).catch((err: any) => {
        logError(`[events] failed to skip ${kind} reminder for event ${event.id}:`, err);
      });
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

    if (delivered === 0) {
      // Nothing got through, so the claim buys us nothing — hand it back and let
      // a later tick retry while the event is still inside its band. Partial
      // delivery keeps the claim: re-posting to channels that already received it
      // would be worse than one channel missing out.
      const released = await this.client.db.event
        .releaseReminder(kind, event.id, now.toISOString())
        .catch((err: any) => {
          logError(`[events] failed to release ${kind} claim for event ${event.id}:`, err);
          return false;
        });
      logError(`[events] ${kind} reminder for event ${event.id} ("${event.name}") reached no channel; `
        + `claim ${released ? 'released for retry' : 'could not be released'}`);
      return;
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
