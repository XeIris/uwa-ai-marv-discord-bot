const diagramGenQueries = {
  LOG_GENERATION: 'INSERT INTO DiagramGenLog (user_id, title, success) VALUES (?, ?, ?)',
  MARK_FAILED: 'UPDATE DiagramGenLog SET success = 0 WHERE id = ?',
  LAST_INSERT_ID: 'SELECT last_insert_rowid() AS id',
  // Rolling 24h window; only successful renders count toward the limit.
  COUNT_LAST_24H: `
    SELECT COUNT(*) AS gen_count
    FROM DiagramGenLog
    WHERE user_id = ? AND success = 1 AND created_at >= datetime('now', '-1 day')
  `,
  CREATE_USER_CREATED_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_diagramgenlog_user_created
    ON DiagramGenLog (user_id, created_at)
  `,
};

export default diagramGenQueries;
