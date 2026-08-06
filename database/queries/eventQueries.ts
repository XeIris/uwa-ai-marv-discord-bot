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
  CREATE_SERVER_STARTS_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_event_server_starts
    ON Event (server_id, starts_at)
  `,
};

export default eventQueries;
