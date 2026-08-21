const eventNoticeQueries = {
  // Read-modify-write, not a clever upsert. Collapsing has to distinguish "this
  // edit didn't touch location" from "this edit cleared location" — both arrive
  // as NULL — and merging that in SQL means a CASE per field over a flag per
  // field. Queueing already runs inside EventModel's transaction, so the read is
  // safe and the merge lives in EventNoticeModel where it can be read.
  GET_PENDING: `
    SELECT * FROM EventNotice
    WHERE event_id = ? AND target = ? AND user_id = ?
  `,
  UPSERT: `
    INSERT INTO EventNotice (
      event_id, server_id, target, user_id, kind, event_name,
      old_starts_at, new_starts_at, old_ends_at, new_ends_at,
      old_location, new_location, dropped_leads, created_at, sent_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT (event_id, target, user_id) DO UPDATE SET
      kind = excluded.kind,
      event_name = excluded.event_name,
      old_starts_at = excluded.old_starts_at,
      new_starts_at = excluded.new_starts_at,
      old_ends_at = excluded.old_ends_at,
      new_ends_at = excluded.new_ends_at,
      old_location = excluded.old_location,
      new_location = excluded.new_location,
      dropped_leads = excluded.dropped_leads,
      -- created_at is deliberately not updated: staleness is measured from when
      -- the change was first queued, so a collapsing edit can't refresh a notice
      -- indefinitely past the point where it's still worth sending.
      sent_at = NULL
  `,
  // A notice that collapsed back to no net change (moved, then moved back) is
  // deleted rather than delivered — see EventNoticeModel.queueWithin.
  DELETE_BY_ID: 'DELETE FROM EventNotice WHERE id = ?',
  LIST_DUE: `
    SELECT * FROM EventNotice
    WHERE sent_at IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `,
  // Claim before sending, same one-shot UPDATE the reminder DMs use.
  MARK_SENT: 'UPDATE EventNotice SET sent_at = ? WHERE id = ? AND sent_at IS NULL',
  LIST_FOR_EVENT: 'SELECT * FROM EventNotice WHERE event_id = ? ORDER BY id ASC',
  CREATE_DUE_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_event_notice_due
    ON EventNotice (sent_at, created_at)
  `,
};

export default eventNoticeQueries;
