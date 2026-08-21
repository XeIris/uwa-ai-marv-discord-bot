import type { TableDefinition } from '../types';

export interface EventReminderRow {
  id: number;
  event_id: number;
  server_id: string;
  user_id: string;
  lead: string;
  due_at: string;
  sent_at: string | null;
  created_at: string;
}

/**
 * Per-user DM reminders for an event ("remind me a week before").
 *
 * Unlike the channel reminders — two fixed bands tracked by marker columns on the
 * Event row — these are per (event, user, lead), so they need their own rows.
 *
 * `due_at` is an **absolute ISO-8601 UTC instant, resolved when the user
 * subscribes**, not a lead offset applied at sweep time. That makes the sweep one
 * indexed range scan across every guild, and it's the only clean way to express
 * the `morning` lead, which is a Perth wall-clock time (09:00 on the day) rather
 * than an offset from the start. The cost is that anything moving `starts_at` has
 * to recompute it — EventModel.update does, inside the same transaction.
 *
 * The FK cascade drops a deleted event's subscriptions (foreign keys are ON, set
 * at the end of Database.init). The sweep also joins Event, so even with the
 * pragma off an orphaned row can never DM anyone about an event that's gone.
 */
const eventReminderTable: TableDefinition = {
  name: 'EventReminder',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'event_id', type: 'INTEGER NOT NULL' },
    // Denormalised from Event so a subscription can be listed/revoked without a join.
    { name: 'server_id', type: 'TEXT NOT NULL' },
    { name: 'user_id', type: 'TEXT NOT NULL' },
    { name: 'lead', type: 'TEXT NOT NULL' },
    { name: 'due_at', type: 'TEXT NOT NULL' },
    // Set once the DM has been attempted, so a restart can't double-send.
    { name: 'sent_at', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [
    'UNIQUE (event_id, user_id, lead)',
    'FOREIGN KEY (event_id) REFERENCES Event(id) ON DELETE CASCADE',
  ],
};

export default eventReminderTable;
