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
  // Events needing a reminder: inside this reminder's lead-time band, not yet
  // sent, not already started, and belonging to a guild that has opted in.
  //
  // The guild filter is part of the SQL, not a post-filter in the scheduler,
  // because LIMIT is applied here: events in guilds that never configured a
  // channel keep their marker NULL by design, so as a post-filter they would be
  // re-selected every tick and could fill the batch, starving guilds that did
  // configure one.
  //
  // The column name is interpolated from a fixed allowlist in EventModel — never
  // from caller input — because SQLite can't parameterise an identifier. The
  // config key is a bound parameter.
  LIST_DUE_REMINDERS: (column: string): string => `
    SELECT * FROM Event
    WHERE ${column} IS NULL
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
  MARK_REMINDER_SENT: (column: string): string => `
    UPDATE Event SET ${column} = ? WHERE id = ? AND ${column} IS NULL
  `,
  // Hands a claim back when delivery failed outright, so a later tick retries.
  // Matching on the timestamp we wrote means we can never clear a claim that a
  // different tick has since taken.
  RELEASE_REMINDER: (column: string): string => `
    UPDATE Event SET ${column} = NULL WHERE id = ? AND ${column} = ?
  `,
  CREATE_SERVER_STARTS_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_event_server_starts
    ON Event (server_id, starts_at)
  `,
};

export default eventQueries;
