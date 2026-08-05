const imageGenQueries = {
  LOG_GENERATION: 'INSERT INTO ImageGenLog (user_id, prompt, model, success) VALUES (?, ?, ?, ?)',
  MARK_FAILED: 'UPDATE ImageGenLog SET success = 0 WHERE id = ?',
  LAST_INSERT_ID: 'SELECT last_insert_rowid() AS id',
  // Rolling 24h window; only successful generations count toward the limit.
  COUNT_LAST_24H: `
    SELECT COUNT(*) AS gen_count
    FROM ImageGenLog
    WHERE user_id = ? AND success = 1 AND created_at >= datetime('now', '-1 day')
  `,
  CREATE_USER_CREATED_INDEX: `
    CREATE INDEX IF NOT EXISTS idx_imagegenlog_user_created
    ON ImageGenLog (user_id, created_at)
  `,
};

export default imageGenQueries;
