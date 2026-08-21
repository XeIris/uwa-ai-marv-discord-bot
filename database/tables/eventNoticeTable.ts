import type { TableDefinition } from '../types';

export interface EventNoticeRow {
  id: number;
  event_id: number;
  server_id: string;
  target: string;
  user_id: string;
  kind: string;
  event_name: string;
  old_starts_at: string | null;
  new_starts_at: string | null;
  old_ends_at: string | null;
  new_ends_at: string | null;
  old_location: string | null;
  new_location: string | null;
  dropped_leads: string | null;
  created_at: string;
  sent_at: string | null;
}

/**
 * Queued "this event changed" / "this event is off" messages, drained by the
 * scheduler tick.
 *
 * A queue rather than DMing straight from `/event edit` for three reasons: the
 * command must not block on a hundred DMs; a restart mid-loop would lose them
 * silently; and the sweep already owns the claim / stagger / stale machinery the
 * reminder DMs use.
 *
 * **Deliberately not FK'd to Event.** A cancellation notice has to outlive the
 * row it's about, which is why `event_name` is snapshotted here rather than
 * joined. The reminder sweep's orphan protection comes from its JOIN; this one
 * gets it from `sent_at` plus the staleness cut-off.
 *
 * `target` splits the two fan-outs: `dm` rows carry a `user_id`, `channel` rows
 * carry `''` and go to the guild's `event_reminder_channels`. The empty string
 * rather than NULL is load-bearing — SQLite treats NULLs as distinct in a UNIQUE
 * index, so a nullable `user_id` would defeat the collapsing below and post one
 * channel message per edit.
 *
 * The UNIQUE triple is what makes edits collapse: queueing keeps the *earliest*
 * `old_*` and overwrites the `new_*`, so an admin nudging the time five times
 * sends one "19:00 → 20:30" DM, and moving an event and moving it back sends
 * none at all (delivery drops fields where old equals new).
 */
const eventNoticeTable: TableDefinition = {
  name: 'EventNotice',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'event_id', type: 'INTEGER NOT NULL' },
    { name: 'server_id', type: 'TEXT NOT NULL' },
    // 'dm' | 'channel'
    { name: 'target', type: "TEXT NOT NULL DEFAULT 'dm'" },
    // The recipient for a dm notice; '' for a channel notice (see above).
    { name: 'user_id', type: "TEXT NOT NULL DEFAULT ''" },
    // 'changed' | 'cancelled'
    { name: 'kind', type: 'TEXT NOT NULL' },
    // Snapshot: a cancellation notice outlives the event row it names.
    { name: 'event_name', type: 'TEXT NOT NULL' },
    // Per-field before/after. NULL on both sides means "this field didn't change".
    { name: 'old_starts_at', type: 'TEXT' },
    { name: 'new_starts_at', type: 'TEXT' },
    { name: 'old_ends_at', type: 'TEXT' },
    { name: 'new_ends_at', type: 'TEXT' },
    { name: 'old_location', type: 'TEXT' },
    { name: 'new_location', type: 'TEXT' },
    // Comma-separated leads this user lost because they no longer resolve against
    // the new start time — the one part of a notice that differs per recipient.
    { name: 'dropped_leads', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
    { name: 'sent_at', type: 'TEXT' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: ['UNIQUE (event_id, target, user_id)'],
};

export default eventNoticeTable;
