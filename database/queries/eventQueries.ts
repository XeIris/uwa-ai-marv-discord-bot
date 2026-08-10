const eventQueries = {
  CREATE_EVENT: `
    INSERT INTO Event (server_id, name, description, starts_at, ends_at, location, url, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  LAST_INSERT_ID: 'SELECT last_insert_rowid() AS id',
  UPDATE_EVENT: `
    UPDATE Event
    SET name = ?, description = ?, starts_at = ?, ends_at = ?, location = ?, url = ?
    WHERE id = ? AND server_id = ?
  `,
  DELETE_EVENT: 'DELETE FROM Event WHERE id = ? AND server_id = ?',
  GET_EVENT: 'SELECT * FROM Event WHERE id = ? AND server_id = ?',
  LIST_ALL: 'SELECT * FROM Event WHERE server_id = ? ORDER BY starts_at ASC LIMIT ?',
  // An event stays "upcoming" until its end time; events with no end fall off at start.
  LIST_UPCOMING: `
    SELECT * FROM Event
    WHERE server_id = ? AND COALESCE(ends_at, starts_at) >= ?
    ORDER BY starts_at ASC
    LIMIT ?
  `,
  SET_IMAGE: `
    UPDATE Event
    SET image_channel_id = ?, image_message_id = ?, image_attachment_id = ?
    WHERE id = ? AND server_id = ?
  `,
  CLEAR_IMAGE: `
    UPDATE Event
    SET image_channel_id = NULL, image_message_id = NULL, image_attachment_id = NULL
    WHERE id = ? AND server_id = ?
  `,
  // Same, but only if the stored reference is still the one the caller resolved.
  // Guards the read-then-clear race: an organiser can run /event setimage between
  // a failed resolution and the prune, and the new reference must survive.
  CLEAR_IMAGE_IF_MATCHES: `
    UPDATE Event
    SET image_channel_id = NULL, image_message_id = NULL, image_attachment_id = NULL
    WHERE id = ? AND server_id = ?
      AND image_channel_id = ? AND image_message_id = ? AND image_attachment_id = ?
  `,
  // Reminder queries are written out **statically per reminder kind** rather than
  // built from a column name. SQLite can't parameterise an identifier, so the
  // alternative was interpolating one — safe today because EventModel only ever
  // passes a constant, but a builder taking `column: string` puts no boundary in
  // the queries layer itself. Two kinds x three statements is a little verbose and
  // completely greppable, which is the trade this file wants.
  //
  // Each SELECT returns events inside that reminder's lead-time band, not yet
  // sent, not yet started, in a guild that has opted in. The guild filter is in
  // the SQL and not a post-filter in the scheduler because LIMIT is applied here:
  // events in guilds that never configured a channel keep their marker NULL by
  // design, so as a post-filter they'd be re-selected every tick and could fill
  // the batch and starve guilds that did configure one.
  LIST_DUE_REMINDERS: {
    day: `
      SELECT * FROM Event
      WHERE reminder_day_sent_at IS NULL
        AND starts_at > ?
        AND starts_at <= ?
        AND EXISTS (
          SELECT 1 FROM ServerConfig sc
          WHERE sc.server_id = Event.server_id
            AND sc.key = ?
            AND TRIM(sc.value) <> ''
        )
      ORDER BY starts_at ASC
      LIMIT ?
    `,
    soon: `
      SELECT * FROM Event
      WHERE reminder_soon_sent_at IS NULL
        AND starts_at > ?
        AND starts_at <= ?
        AND EXISTS (
          SELECT 1 FROM ServerConfig sc
          WHERE sc.server_id = Event.server_id
            AND sc.key = ?
            AND TRIM(sc.value) <> ''
        )
      ORDER BY starts_at ASC
      LIMIT ?
    `,
  },
  // Claim: conditional on the marker still being NULL, so two ticks can't both win.
  MARK_REMINDER_SENT: {
    day: 'UPDATE Event SET reminder_day_sent_at = ? WHERE id = ? AND reminder_day_sent_at IS NULL',
    soon: 'UPDATE Event SET reminder_soon_sent_at = ? WHERE id = ? AND reminder_soon_sent_at IS NULL',
  },
  // Hands a claim back when delivery failed outright, so a later tick retries.
  // Matching on the timestamp we wrote means we can never clear a claim that a
  // different tick has since taken.
  RELEASE_REMINDER: {
    day: 'UPDATE Event SET reminder_day_sent_at = NULL WHERE id = ? AND reminder_day_sent_at = ?',
    soon: 'UPDATE Event SET reminder_soon_sent_at = NULL WHERE id = ? AND reminder_soon_sent_at = ?',
  },
  CREATE_SERVER_STARTS_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_event_server_starts
    ON Event (server_id, starts_at)
  `,
};

export default eventQueries;
