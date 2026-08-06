const committeeQueries = {
  UPSERT_MEMBER: `
    INSERT INTO Committee (server_id, user_id, title, display_name, is_executive, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (server_id, user_id, title) DO UPDATE SET
      display_name = excluded.display_name,
      is_executive = excluded.is_executive,
      sort_order = excluded.sort_order,
      updated_at = CURRENT_TIMESTAMP
  `,
  UPDATE_MEMBER: `
    UPDATE Committee
    SET title = ?, display_name = ?, is_executive = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE server_id = ? AND user_id = ? AND title = ?
  `,
  DELETE_MEMBER_TITLE: 'DELETE FROM Committee WHERE server_id = ? AND user_id = ? AND title = ?',
  DELETE_MEMBER_ALL: 'DELETE FROM Committee WHERE server_id = ? AND user_id = ?',
  GET_ENTRY: `
    SELECT * FROM Committee
    WHERE server_id = ? AND user_id = ? AND title = ?
  `,
  LIST_BY_SERVER: `
    SELECT * FROM Committee
    WHERE server_id = ?
    ORDER BY is_executive DESC, sort_order ASC, title ASC
  `,
  LIST_TITLES_FOR_USER: `
    SELECT title FROM Committee
    WHERE server_id = ? AND user_id = ?
    ORDER BY is_executive DESC, sort_order ASC
  `,
  CREATE_SERVER_ORDER_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_committee_server_order
    ON Committee (server_id, sort_order)
  `,
};

export default committeeQueries;
