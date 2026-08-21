import eventNoticeQueries from '../queries/eventNoticeQueries';
import { REMINDER_LEADS } from '../../utils/eventReminders';
import type { ReminderLead } from '../../utils/eventReminders';
import type Database from '../Database';

export const NOTICE_TARGETS = ['dm', 'channel'] as const;
export type NoticeTarget = typeof NOTICE_TARGETS[number];

export const NOTICE_KINDS = ['changed', 'cancelled'] as const;
export type NoticeKind = typeof NOTICE_KINDS[number];

/** The `user_id` a channel-targeted notice carries. See eventNoticeTable. */
export const CHANNEL_RECIPIENT = '';

export interface EventNoticeEntry {
  id: number;
  eventId: number;
  serverId: string;
  target: NoticeTarget;
  userId: string;
  kind: NoticeKind;
  eventName: string;
  oldStartsAt: string | null;
  newStartsAt: string | null;
  oldEndsAt: string | null;
  newEndsAt: string | null;
  oldLocation: string | null;
  newLocation: string | null;
  droppedLeads: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** One before/after pair. `touched` false means this edit left the field alone. */
export interface FieldChange {
  touched: boolean;
  old: string | null;
  next: string | null;
}

const UNTOUCHED: FieldChange = { touched: false, old: null, next: null };

/** Builds a FieldChange, marking it untouched when nothing actually differs. */
export function fieldChange(old: string | null, next: string | null): FieldChange {
  if ((old ?? null) === (next ?? null)) return UNTOUCHED;
  return { touched: true, old: old ?? null, next: next ?? null };
}

export interface NoticeInput {
  eventId: number;
  serverId: string;
  target: NoticeTarget;
  userId: string;
  kind: NoticeKind;
  eventName: string;
  startsAt?: FieldChange;
  endsAt?: FieldChange;
  location?: FieldChange;
  droppedLeads?: ReminderLead[];
}

/** Splits the stored comma list back into leads, dropping anything unrecognised. */
export function parseDroppedLeads(value: string | null): ReminderLead[] {
  if (!value) return [];
  return value.split(',')
    .map((lead) => lead.trim())
    .filter((lead): lead is ReminderLead => (REMINDER_LEADS as readonly string[]).includes(lead));
}

class EventNoticeModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  async listDue(limit: number): Promise<EventNoticeEntry[]> {
    return this.db.executeSelectAllQuery(
      eventNoticeQueries.LIST_DUE,
      [limit],
    ) as Promise<EventNoticeEntry[]>;
  }

  /** Claims a notice. False means another tick already took it. */
  async claim(id: number, now: Date = new Date()): Promise<boolean> {
    const result = await this.db.executeQuery(eventNoticeQueries.MARK_SENT, [now.toISOString(), id]);
    return result.changes > 0;
  }

  async listForEvent(eventId: number): Promise<EventNoticeEntry[]> {
    return this.db.executeSelectAllQuery(
      eventNoticeQueries.LIST_FOR_EVENT,
      [eventId],
    ) as Promise<EventNoticeEntry[]>;
  }

  /**
   * Queues (or folds into) one notice, inside the caller's transaction.
   *
   * Merging against a pending notice is what makes repeated edits collapse: the
   * **earliest** `old_*` survives and the newest `new_*` wins, so five nudges
   * read as one "19:00 → 20:30". A notice already delivered starts a fresh one
   * instead of reopening it.
   *
   * If the merged result has no field that actually differs — moved and moved
   * back, or an edit that only touched fields nobody is notified about — the
   * pending notice is deleted rather than delivered. A "this changed" DM that
   * can't say what changed is worse than silence. A `cancelled` notice always
   * stands: its content is the cancellation itself.
   */
  static queueWithin(rawDb: any, input: NoticeInput): void {
    const existing = rawDb.query(eventNoticeQueries.GET_PENDING)
      .get(input.eventId, input.target, input.userId) as Record<string, any> | null;
    // A delivered notice is history — merging into it would rewrite what was
    // already said. Start over from this edit's own before/after.
    const pending = existing && existing.sent_at === null ? existing : null;

    const merge = (
      change: FieldChange | undefined,
      oldColumn: string,
      newColumn: string,
    ): [string | null, string | null] => {
      if (!change?.touched) {
        return pending ? [pending[oldColumn] ?? null, pending[newColumn] ?? null] : [null, null];
      }
      // Keep the pending row's `old` only if it was already tracking this field.
      const trackedBefore = pending
        && (pending[oldColumn] !== null || pending[newColumn] !== null);
      return [trackedBefore ? pending[oldColumn] ?? null : change.old, change.next];
    };

    const [oldStarts, newStarts] = merge(input.startsAt, 'old_starts_at', 'new_starts_at');
    const [oldEnds, newEnds] = merge(input.endsAt, 'old_ends_at', 'new_ends_at');
    const [oldLocation, newLocation] = merge(input.location, 'old_location', 'new_location');

    const leads = new Set<string>([
      ...(pending ? parseDroppedLeads(pending.dropped_leads ?? null) : []),
      ...(input.droppedLeads ?? []),
    ]);
    const droppedLeads = leads.size > 0 ? [...leads].join(',') : null;

    const somethingDiffers = oldStarts !== newStarts
      || oldEnds !== newEnds
      || oldLocation !== newLocation
      || leads.size > 0;

    if (input.kind === 'changed' && !somethingDiffers) {
      if (pending) rawDb.query(eventNoticeQueries.DELETE_BY_ID).run(pending.id);
      return;
    }

    rawDb.query(eventNoticeQueries.UPSERT).run(
      input.eventId,
      input.serverId,
      input.target,
      input.userId,
      input.kind,
      input.eventName,
      oldStarts,
      newStarts,
      oldEnds,
      newEnds,
      oldLocation,
      newLocation,
      droppedLeads,
    );
  }
}

export default EventNoticeModel;
