const eventReminderQueries = {
  // Upsert rather than insert-or-fail: re-subscribing to a lead you already have
  // should re-arm it (clearing sent_at) rather than error, which is also what
  // makes the recompute below safe to run repeatedly.
  SUBSCRIBE: `
    INSERT INTO EventReminder (event_id, server_id, user_id, lead, due_at, sent_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT (event_id, user_id, lead)
    DO UPDATE SET due_at = excluded.due_at, sent_at = NULL
  `,
  UNSUBSCRIBE: 'DELETE FROM EventReminder WHERE event_id = ? AND user_id = ? AND lead = ?',
  UNSUBSCRIBE_ALL_FOR_EVENT: 'DELETE FROM EventReminder WHERE event_id = ? AND user_id = ?',
  LIST_FOR_USER_EVENT: `
    SELECT * FROM EventReminder
    WHERE event_id = ? AND user_id = ?
    ORDER BY due_at ASC
  `,
  // A user's whole subscription list for one guild, joined so it can be shown with
  // event names and so subscriptions to a deleted event never surface.
  LIST_FOR_USER: `
    SELECT r.*, e.name AS event_name, e.starts_at AS event_starts_at
    FROM EventReminder r
    JOIN Event e ON e.id = r.event_id
    WHERE r.server_id = ? AND r.user_id = ? AND e.starts_at > ?
    ORDER BY r.due_at ASC
    LIMIT ?
  `,
  // Due DMs, across every guild — the scheduler sweeps all of them.
  //
  // The JOIN is load-bearing twice over: it supplies the event fields the DM
  // embed needs in one query, and it means an orphaned subscription row (which
  // the FK cascade should already have removed) can never DM anyone about an
  // event that no longer exists. `e.starts_at > ?` is the same rule the channel
  // reminders follow — a bot that was offline overnight comes back quiet instead
  // of announcing things that already happened.
  LIST_DUE: `
    SELECT r.*, e.name AS event_name, e.starts_at AS event_starts_at
    FROM EventReminder r
    JOIN Event e ON e.id = r.event_id
    WHERE r.sent_at IS NULL
      AND r.due_at <= ?
      AND e.starts_at > ?
    ORDER BY r.due_at ASC
    LIMIT ?
  `,
  // Claim before sending, conditional on the marker still being NULL, so two
  // overlapping ticks can't both DM. Unlike the channel reminders there is no
  // release path: a failed DM is almost always closed DMs or a block, which
  // retrying every five minutes until the event starts would not fix.
  MARK_SENT: 'UPDATE EventReminder SET sent_at = ? WHERE id = ? AND sent_at IS NULL',
  // Recomputes one lead's due time after the event was rescheduled. Re-arms
  // (sent_at = NULL) only when the new time is still in the future, so moving an
  // event later re-notifies but a cosmetic edit doesn't re-DM everyone.
  RESCHEDULE_LEAD: `
    UPDATE EventReminder
    SET due_at = ?, sent_at = CASE WHEN ? > ? THEN NULL ELSE sent_at END
    WHERE event_id = ? AND lead = ?
  `,
  // Leads that no longer resolve against the new start time (a 9am event has no
  // "morning of") lose their subscriptions rather than keeping a stale due_at.
  DELETE_LEAD_FOR_EVENT: 'DELETE FROM EventReminder WHERE event_id = ? AND lead = ?',
  // Everyone with any lead on this event. Read *before* a reschedule, because a
  // subscriber whose only lead stops resolving is deleted by it — and they are
  // precisely the person who most needs telling.
  LIST_SUBSCRIBER_IDS: 'SELECT DISTINCT user_id FROM EventReminder WHERE event_id = ?',
  LIST_USERS_FOR_LEAD: 'SELECT user_id FROM EventReminder WHERE event_id = ? AND lead = ?',
  COUNT_FOR_EVENT: 'SELECT COUNT(*) AS count FROM EventReminder WHERE event_id = ?',
  // Backs the sweep's (sent_at, due_at) scan.
  CREATE_DUE_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_event_reminder_due
    ON EventReminder (sent_at, due_at)
  `,
  CREATE_USER_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_event_reminder_user
    ON EventReminder (server_id, user_id)
  `,
};

export default eventReminderQueries;
