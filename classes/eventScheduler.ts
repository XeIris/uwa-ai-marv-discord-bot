import { EmbedBuilder } from 'discord.js';
import { log, logError } from '../utils/log';
import { loadResolvedServerConfig, SERVER_CONFIG_KEYS } from '../utils/serverConfig';
import { discordTimestamp } from '../utils/perthTime';
import { resolveAndPrune } from '../utils/eventImage';
import type { EventEntry, ReminderKind } from '../database/models/EventModel';
import type { DueEventReminder } from '../database/models/EventReminderModel';
import { parseDroppedLeads, parseNoticeTimestamp } from '../database/models/EventNoticeModel';
import type { EventNoticeEntry } from '../database/models/EventNoticeModel';
import { LEAD_LABELS, toReminderLead } from '../utils/eventReminders';

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
 *
 * The same tick also delivers the per-user DM reminders from `/event remindme`.
 * Those are unconditional — a member opting into a DM about their own club's
 * event needs no guild opt-in — and are driven by absolute `due_at` instants
 * rather than bands, because one of the leads is a Perth wall-clock time. See
 * `utils/eventReminders.ts`.
 *
 * Finally it drains the EventNotice queue — "this event moved", "this event is
 * off" — which `/event edit` and `/event delete` fill inside their own
 * transactions. Those go to subscribers by DM *and* to the guild's reminder
 * channels, so a member who never subscribed still finds out.
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
/**
 * DM cap per tick. Direct messages are rate-limited far more aggressively than
 * channel sends, and a popular event can have hundreds of subscribers whose
 * reminders all come due in the same minute. Anything over the cap simply waits
 * for the next tick — every lead has hours of slack before its event.
 */
const MAX_DMS_PER_TICK = 40;
/** Spacing between DMs, so a full batch doesn't trip the global DM rate limit. */
const DM_STAGGER_MS = 250;
/**
 * How late a DM may be and still be worth sending. A bot down for two days
 * shouldn't wake up and tell someone their reminder was a week ago — past this
 * the subscription is consumed silently. Comfortably longer than any plausible
 * restart, far shorter than the gap between leads.
 */
const STALE_DM_MS = 6 * HOUR_MS;
const MAX_NOTICES_PER_TICK = 40;
/**
 * How late a change notice may be delivered. Longer than the reminder cut-off:
 * "this moved to Thursday" stays useful for far longer than "this starts in an
 * hour" does, and a cancellation is worth hearing late. Past a day it's history.
 */
const STALE_NOTICE_MS = 24 * HOUR_MS;

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
        await this.sweep(kind, now);
      }
      await this.sweepDirectMessages(now);
      await this.sweepNotices(now);
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
        const channel = await this.client.channels.fetch(channelId);
        if (!channel?.isTextBased?.()) {
          log(`[events] reminder channel ${channelId} in guild ${event.serverId} is not text-based; skipping`);
          continue;
        }

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

  /**
   * Delivers the per-user DM reminders whose `due_at` has passed.
   *
   * Same claim-then-send ordering as the channel reminders, but with **no
   * release**: a DM failure is almost always closed DMs, a block, or a departed
   * user, none of which a retry five minutes later fixes — it would just re-fail
   * every tick until the event started. The claim is kept and the failure logged.
   */
  private async sweepDirectMessages(now: Date): Promise<void> {
    let due: DueEventReminder[];
    try {
      due = await this.client.db.eventReminder.listDue(MAX_DMS_PER_TICK, now);
    } catch (err) {
      logError('[events] failed to list due DM reminders:', err);
      return;
    }
    if (due.length === 0) return;

    let sent = 0;
    for (const reminder of due) {
      const delivered = await this.sendReminderDm(reminder, now);
      if (delivered) {
        sent += 1;
        // Space out real sends only — skipped/stale rows cost no rate limit.
        if (sent < due.length) {
          await new Promise((resolve) => { setTimeout(resolve, DM_STAGGER_MS); });
        }
      }
    }
    log(`[events] delivered ${sent}/${due.length} due DM reminder(s)`);
  }

  /** One subscriber's DM. Returns whether a message actually went out. */
  private async sendReminderDm(reminder: DueEventReminder, now: Date): Promise<boolean> {
    const stale = now.getTime() - new Date(reminder.dueAt).getTime() > STALE_DM_MS;

    let claimed = false;
    try {
      claimed = await this.client.db.eventReminder.claim(reminder.id, now);
    } catch (err) {
      logError(`[events] failed to claim DM reminder ${reminder.id}:`, err);
      return false;
    }
    if (!claimed) return false;

    if (stale) {
      // Claimed and dropped: the bot was down long enough that this reminder has
      // lost its meaning. Consuming it stops it resurfacing every tick.
      log(`[events] DM reminder ${reminder.id} was due ${reminder.dueAt} — too stale to send, skipped`);
      return false;
    }

    try {
      const user = await this.client.users.fetch(reminder.userId);
      await user.send({ embeds: [this.buildDmEmbed(reminder)] });
      return true;
    } catch (err) {
      // 50007 = Cannot send messages to this user (DMs closed, or we're blocked).
      const code = (err as any)?.code ?? (err as any)?.rawError?.code;
      if (code === 50007) {
        log(`[events] couldn't DM ${reminder.userId} for event ${reminder.eventId} — their DMs are closed`);
      } else {
        logError(`[events] failed to DM reminder ${reminder.id} to ${reminder.userId}:`, err);
      }
      return false;
    }
  }

  private buildDmEmbed(reminder: DueEventReminder): EmbedBuilder {
    const lead = toReminderLead(reminder.lead);
    const when = `${discordTimestamp(reminder.eventStartsAt)} (${discordTimestamp(reminder.eventStartsAt, 'R')})`;
    const because = lead
      ? `You asked to be reminded ${LEAD_LABELS[lead]}.`
      : 'You asked to be reminded about this event.';

    return new EmbedBuilder()
      .setTitle(`Reminder — ${reminder.eventName}`)
      .setDescription(`${when}\n\n${because}\nStop these with \`/event remindme\` → \`cancel: True\`.`)
      .setColor('#FEE75C');
  }

  /**
   * Drains queued change/cancellation notices.
   *
   * Same claim-then-send, no-release contract as the reminder DMs. A channel
   * notice for a guild with no `event_reminder_channels` is claimed and dropped:
   * the row is queued unconditionally by the DB layer (which can't see guild
   * config), and this is where opting out is honoured.
   */
  private async sweepNotices(now: Date): Promise<void> {
    let due: EventNoticeEntry[];
    try {
      due = await this.client.db.eventNotice.listDue(MAX_NOTICES_PER_TICK);
    } catch (err) {
      logError('[events] failed to list due notices:', err);
      return;
    }
    if (due.length === 0) return;

    let delivered = 0;
    for (const notice of due) {
      const sent = await this.deliverNotice(notice, now);
      if (sent) {
        delivered += 1;

        await new Promise((resolve) => { setTimeout(resolve, DM_STAGGER_MS); });
      }
    }
    log(`[events] delivered ${delivered}/${due.length} event notice(s)`);
  }

  private async deliverNotice(notice: EventNoticeEntry, now: Date): Promise<boolean> {
    const stale = now.getTime() - parseNoticeTimestamp(notice.createdAt).getTime() > STALE_NOTICE_MS;

    let claimed = false;
    try {
      claimed = await this.client.db.eventNotice.claim(notice.id, now);
    } catch (err) {
      logError(`[events] failed to claim notice ${notice.id}:`, err);
      return false;
    }
    if (!claimed) return false;

    if (stale) {
      log(`[events] notice ${notice.id} was queued ${notice.createdAt} — too stale to send, skipped`);
      return false;
    }

    const embed = this.buildNoticeEmbed(notice);
    if (notice.target === 'channel') return this.postNoticeToChannels(notice, embed);

    try {
      const user = await this.client.users.fetch(notice.userId);
      await user.send({ embeds: [embed] });
      return true;
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.rawError?.code;
      if (code === 50007) {
        log(`[events] couldn't DM ${notice.userId} about event ${notice.eventId} — their DMs are closed`);
      } else {
        logError(`[events] failed to DM notice ${notice.id} to ${notice.userId}:`, err);
      }
      return false;
    }
  }

  private async postNoticeToChannels(notice: EventNoticeEntry, embed: EmbedBuilder): Promise<boolean> {
    let channelIds: string[];
    try {
      const config = await loadResolvedServerConfig(this.client.db, notice.serverId);
      channelIds = config.eventReminderChannelIds;
    } catch (err) {
      logError(`[events] failed to read config for guild ${notice.serverId}:`, err);
      return false;
    }
    // No configured channel is an opt-out, not a failure — the claim stands.
    if (channelIds.length === 0) return false;

    let delivered = 0;
    for (const channelId of channelIds) {
      try {
        const channel = await this.client.channels.fetch(channelId);
        if (!channel?.isTextBased?.()) continue;

        await channel.send({ embeds: [embed] });
        delivered += 1;
      } catch (err) {
        logError(`[events] failed to post notice ${notice.id} to ${channelId}:`, err);
      }
    }
    return delivered > 0;
  }

  /**
   * Renders a notice. Only fields whose before and after actually differ are
   * shown — the queue collapses repeated edits into one row, and an untouched
   * field is stored as NULL on both sides.
   */
  private buildNoticeEmbed(notice: EventNoticeEntry): EmbedBuilder {
    if (notice.kind === 'cancelled') {
      const was = notice.oldStartsAt ? `\n\nIt was scheduled for ${discordTimestamp(notice.oldStartsAt)}.` : '';
      return new EmbedBuilder()
        .setTitle(`Cancelled — ${notice.eventName}`)
        .setDescription(`**${notice.eventName}** is no longer happening.${was}`
          + '\n\nAny reminders you had for it have been removed.')
        .setColor('#ED4245');
    }

    const lines: string[] = [];
    if (notice.oldStartsAt !== notice.newStartsAt && notice.newStartsAt) {
      lines.push(`🕒 **New time:** ${discordTimestamp(notice.newStartsAt)} `
        + `(${discordTimestamp(notice.newStartsAt, 'R')})`);
      if (notice.oldStartsAt) lines.push(`Was: ${discordTimestamp(notice.oldStartsAt)}`);
    }
    if (notice.oldEndsAt !== notice.newEndsAt) {
      lines.push(notice.newEndsAt
        ? `⏳ **Now ends:** ${discordTimestamp(notice.newEndsAt)}`
        : '⏳ **End time removed.**');
    }
    if (notice.oldLocation !== notice.newLocation) {
      lines.push(notice.newLocation
        ? `📍 **New location:** ${notice.newLocation}${notice.oldLocation ? ` (was ${notice.oldLocation})` : ''}`
        : '📍 **Location removed.**');
    }

    const dropped = parseDroppedLeads(notice.droppedLeads);
    if (dropped.length > 0) {
      // The one part of a notice that is specific to this recipient: their lead
      // no longer resolves against the new start, so it was deleted. Say so —
      // silently dropping someone's reminder is the failure this exists to avoid.
      const labels = dropped.map((lead) => `**${LEAD_LABELS[lead]}**`).join(' and ');
      lines.push('', `⚠ Your reminder ${labels} doesn't work with the new time, so I've removed it. `
        + 'Set another with `/event remindme`.');
    }

    return new EmbedBuilder()
      .setTitle(`Updated — ${notice.eventName}`)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setColor('#FAA61A');
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
