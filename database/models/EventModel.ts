import eventQueries from '../queries/eventQueries';
import type Database from '../Database';

/** An event row as returned by the DB layer (snake_case columns are camelized). */
export interface EventEntry {
  id: number;
  serverId: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  url: string | null;
  createdBy: string | null;
  createdAt: string;
  imageChannelId: string | null;
  imageMessageId: string | null;
  imageAttachmentId: string | null;
  reminderDaySentAt: string | null;
  reminderSoonSentAt: string | null;
}

/**
 * The two reminder marker columns. SQLite cannot parameterise an identifier, so
 * the column name is interpolated into the SQL — it must therefore only ever
 * come from this constant, never from a caller.
 */
export const REMINDER_COLUMNS = {
  day: 'reminder_day_sent_at',
  soon: 'reminder_soon_sent_at',
} as const;

export type ReminderKind = keyof typeof REMINDER_COLUMNS;

export interface EventInput {
  name?: string;
  description?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  url?: string | null;
}

class EventModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /** Creates an event and returns its id. startsAt/endsAt are ISO-8601 UTC strings. */
  async create(
    serverId: string,
    fields: EventInput & { name: string; startsAt: string },
    createdBy: string | null = null,
  ): Promise<number | null> {
    return this.db.executeTransaction((rawDb) => {
      rawDb.query(eventQueries.CREATE_EVENT).run(
        serverId,
        fields.name,
        fields.description ?? null,
        fields.startsAt,
        fields.endsAt ?? null,
        fields.location ?? null,
        fields.url ?? null,
        createdBy,
      );
      const idRow = rawDb.query(eventQueries.LAST_INSERT_ID).get() as { id: number };
      return idRow.id;
    });
  }

  /** Rewrites an event; fields left undefined keep their current value. */
  async update(serverId: string, id: number, changes: EventInput): Promise<boolean> {
    const existing = await this.getById(serverId, id);
    if (!existing) return false;

    const pick = <T>(next: T | undefined, current: T): T => (next === undefined ? current : next);
    const result = await this.db.executeQuery(eventQueries.UPDATE_EVENT, [
      pick(changes.name, existing.name),
      pick(changes.description, existing.description),
      pick(changes.startsAt, existing.startsAt),
      pick(changes.endsAt, existing.endsAt),
      pick(changes.location, existing.location),
      pick(changes.url, existing.url),
      id,
      serverId,
    ]);
    return result.changes > 0;
  }

  async delete(serverId: string, id: number): Promise<boolean> {
    const result = await this.db.executeQuery(eventQueries.DELETE_EVENT, [id, serverId]);
    return result.changes > 0;
  }

  async getById(serverId: string, id: number): Promise<EventEntry | null> {
    const row = await this.db.executeSelectQuery(eventQueries.GET_EVENT, [id, serverId]);
    return (row as EventEntry) ?? null;
  }

  async listAll(serverId: string, limit = 50): Promise<EventEntry[]> {
    return this.db.executeSelectAllQuery(eventQueries.LIST_ALL, [serverId, limit]) as Promise<EventEntry[]>;
  }

  /** Points an event at the Discord message holding its image (ids, not a URL). */
  async setImage(
    serverId: string,
    id: number,
    ref: { channelId: string; messageId: string; attachmentId: string },
  ): Promise<boolean> {
    const result = await this.db.executeQuery(
      eventQueries.SET_IMAGE,
      [ref.channelId, ref.messageId, ref.attachmentId, id, serverId],
    );
    return result.changes > 0;
  }

  /** Forgets an event's image reference outright (explicit removal by an admin). */
  async clearImage(serverId: string, id: number): Promise<boolean> {
    const result = await this.db.executeQuery(eventQueries.CLEAR_IMAGE, [id, serverId]);
    return result.changes > 0;
  }

  /**
   * Forgets an image reference only if it's still the one given. Used when a
   * resolution found the source message gone: an organiser may have replaced the
   * image in the meantime, and that newer reference must not be wiped.
   */
  async clearImageIfMatches(
    serverId: string,
    id: number,
    ref: { channelId: string; messageId: string; attachmentId: string },
  ): Promise<boolean> {
    const result = await this.db.executeQuery(
      eventQueries.CLEAR_IMAGE_IF_MATCHES,
      [id, serverId, ref.channelId, ref.messageId, ref.attachmentId],
    );
    return result.changes > 0;
  }

  /**
   * Events whose start falls in this reminder's **lead-time band** — more than
   * `fromMs` and at most `toMs` from now — and whose `kind` reminder hasn't been
   * sent. Only guilds that set `reminderConfigKey` are considered.
   *
   * The band matters: selecting everything before `now + toMs` meant the 24-hour
   * sweep announced "tomorrow" for an event two hours away. The band is far wider
   * than the tick interval, so a delayed or skipped tick still catches it.
   *
   * Deliberately **not** scoped to one guild: the scheduler sweeps every server
   * in one pass and routes by each row's serverId.
   */
  async listDueReminders(
    kind: ReminderKind,
    fromMs: number,
    toMs: number,
    reminderConfigKey: string,
    limit = 50,
    now: Date = new Date(),
  ): Promise<EventEntry[]> {
    const after = new Date(now.getTime() + fromMs);
    const until = new Date(now.getTime() + toMs);
    return this.db.executeSelectAllQuery(
      eventQueries.LIST_DUE_REMINDERS(REMINDER_COLUMNS[kind]),
      [after.toISOString(), until.toISOString(), reminderConfigKey, limit],
    ) as Promise<EventEntry[]>;
  }

  /**
   * Marks a reminder sent. The `IS NULL` guard in the UPDATE makes this the
   * claim step: it returns false if another tick already took this event, so a
   * slow post can never be duplicated.
   */
  async claimReminder(kind: ReminderKind, id: number, now: Date = new Date()): Promise<boolean> {
    const result = await this.db.executeQuery(
      eventQueries.MARK_REMINDER_SENT(REMINDER_COLUMNS[kind]),
      [now.toISOString(), id],
    );
    return result.changes > 0;
  }

  /**
   * Hands a claim back after delivery failed to every channel, so a later tick
   * retries. `claimedAt` must be the value {@link claimReminder} wrote, so a
   * claim taken by a different tick in the meantime is never cleared.
   */
  async releaseReminder(kind: ReminderKind, id: number, claimedAt: string): Promise<boolean> {
    const result = await this.db.executeQuery(
      eventQueries.RELEASE_REMINDER(REMINDER_COLUMNS[kind]),
      [id, claimedAt],
    );
    return result.changes > 0;
  }

  /** Events that haven't finished yet, soonest first. */
  async listUpcoming(serverId: string, limit = 25, now: Date = new Date()): Promise<EventEntry[]> {
    return this.db.executeSelectAllQuery(
      eventQueries.LIST_UPCOMING,
      [serverId, now.toISOString(), limit],
    ) as Promise<EventEntry[]>;
  }
}

export default EventModel;
