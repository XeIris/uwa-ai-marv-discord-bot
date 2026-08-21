import eventReminderQueries from '../queries/eventReminderQueries';
import { computeDueAt, toReminderLead, REMINDER_LEADS } from '../../utils/eventReminders';
import type { ReminderLead } from '../../utils/eventReminders';
import type Database from '../Database';

/** One user's DM subscription to one lead time on one event. */
export interface EventReminderEntry {
  id: number;
  eventId: number;
  serverId: string;
  userId: string;
  lead: ReminderLead;
  dueAt: string;
  sentAt: string | null;
  createdAt: string;
}

/** A due subscription, carrying the joined event fields the DM embed needs. */
export interface DueEventReminder extends EventReminderEntry {
  eventName: string;
  eventStartsAt: string;
}

/** Rejects a rowid that isn't a positive integer (mirrors EventModel). */
function assertId(id: number, label: string): number {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid ${label}: ${String(id)}`);
  return id;
}

/**
 * Whitelists the lead at the DAO boundary. The commands are typed and the slash
 * options are a fixed choice list, but Discord sends whatever the client sends —
 * an unknown lead must not reach `computeDueAt` or the DB.
 */
function assertLead(lead: ReminderLead): ReminderLead {
  const narrowed = toReminderLead(lead);
  if (!narrowed) throw new Error(`Unknown reminder lead: ${String(lead)}`);
  return narrowed;
}

class EventReminderModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /**
   * Subscribes a user to one lead on one event, resolving the lead into an
   * absolute due time. Returns the due date, or null when the lead doesn't
   * resolve against this start time (see computeDueAt).
   */
  async subscribe(
    serverId: string,
    eventId: number,
    userId: string,
    lead: ReminderLead,
    startsAtIso: string,
  ): Promise<Date | null> {
    const dueAt = computeDueAt(startsAtIso, assertLead(lead));
    if (!dueAt) return null;

    await this.db.executeQuery(eventReminderQueries.SUBSCRIBE, [
      assertId(eventId, 'event id'), serverId, userId, lead, dueAt.toISOString(),
    ]);
    return dueAt;
  }

  async unsubscribe(eventId: number, userId: string, lead: ReminderLead): Promise<boolean> {
    const result = await this.db.executeQuery(
      eventReminderQueries.UNSUBSCRIBE,
      [assertId(eventId, 'event id'), userId, assertLead(lead)],
    );
    return result.changes > 0;
  }

  /** Drops every lead a user holds on one event. Returns how many were removed. */
  async unsubscribeAll(eventId: number, userId: string): Promise<number> {
    const result = await this.db.executeQuery(
      eventReminderQueries.UNSUBSCRIBE_ALL_FOR_EVENT,
      [assertId(eventId, 'event id'), userId],
    );
    return result.changes;
  }

  async listForUserEvent(eventId: number, userId: string): Promise<EventReminderEntry[]> {
    return this.db.executeSelectAllQuery(
      eventReminderQueries.LIST_FOR_USER_EVENT,
      [assertId(eventId, 'event id'), userId],
    ) as Promise<EventReminderEntry[]>;
  }

  /** A user's subscriptions to events in this guild that haven't started yet. */
  async listForUser(
    serverId: string,
    userId: string,
    limit = 50,
    now: Date = new Date(),
  ): Promise<DueEventReminder[]> {
    return this.db.executeSelectAllQuery(
      eventReminderQueries.LIST_FOR_USER,
      [serverId, userId, now.toISOString(), limit],
    ) as Promise<DueEventReminder[]>;
  }

  /** Subscriptions whose due time has passed, for events that haven't started. */
  async listDue(limit: number, now: Date = new Date()): Promise<DueEventReminder[]> {
    const iso = now.toISOString();
    return this.db.executeSelectAllQuery(
      eventReminderQueries.LIST_DUE,
      [iso, iso, limit],
    ) as Promise<DueEventReminder[]>;
  }

  /** Claims a subscription. False means another tick already took it. */
  async claim(id: number, now: Date = new Date()): Promise<boolean> {
    const result = await this.db.executeQuery(
      eventReminderQueries.MARK_SENT,
      [now.toISOString(), assertId(id, 'reminder id')],
    );
    return result.changes > 0;
  }

  async countForEvent(eventId: number): Promise<number> {
    const row = await this.db.executeSelectQuery(
      eventReminderQueries.COUNT_FOR_EVENT,
      [assertId(eventId, 'event id')],
    );
    return (row?.count as number) ?? 0;
  }

  /** Every user holding any lead on this event. Runs inside a caller's transaction. */
  static subscriberIdsWithin(rawDb: any, eventId: number): string[] {
    const rows = rawDb.query(eventReminderQueries.LIST_SUBSCRIBER_IDS)
      .all(eventId) as { user_id: string }[];
    return rows.map((row) => row.user_id);
  }

  /**
   * Recomputes every subscription's due time after an event was rescheduled.
   *
   * Called by EventModel.update whenever `starts_at` changes: `due_at` is an
   * absolute instant, so without this a moved event would keep firing reminders
   * against the old schedule. A lead that no longer resolves (a "morning of" on
   * an event moved to 08:00) is dropped — and **returned**, so the caller can
   * queue a notice telling those subscribers their reminder is gone. Deleting
   * someone's reminder without telling them is the one thing this must not do.
   *
   * Takes the raw handle so it can run inside EventModel.update's transaction —
   * a half-applied reschedule is exactly what this must not leave behind.
   */
  static rescheduleWithin(
    rawDb: any,
    eventId: number,
    startsAtIso: string,
    now: Date = new Date(),
  ): { userId: string; lead: ReminderLead }[] {
    const nowIso = now.toISOString();
    const dropped: { userId: string; lead: ReminderLead }[] = [];

    REMINDER_LEADS.forEach((lead) => {
      const dueAt = computeDueAt(startsAtIso, lead);
      if (!dueAt) {
        const losing = rawDb.query(eventReminderQueries.LIST_USERS_FOR_LEAD)
          .all(eventId, lead) as { user_id: string }[];
        losing.forEach((row) => dropped.push({ userId: row.user_id, lead }));
        rawDb.query(eventReminderQueries.DELETE_LEAD_FOR_EVENT).run(eventId, lead);
        return;
      }
      const dueIso = dueAt.toISOString();
      rawDb.query(eventReminderQueries.RESCHEDULE_LEAD).run(dueIso, dueIso, nowIso, eventId, lead);
    });

    return dropped;
  }
}

export default EventReminderModel;
