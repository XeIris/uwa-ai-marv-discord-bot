const aiUsageQueries = {
  // Immutable per-call audit log (per-model tokens + cost). Enforcement no longer
  // reads this — it uses the AiRateLimitWindow counter below — but it's kept for
  // history/cost accounting.
  ADD_USAGE: `
    INSERT INTO AiUsage (user_id, model, tokens_prompt, tokens_completion, cost)
    VALUES (?, ?, ?, ?, ?)
  `,
  // Fixed-window (Claude-style) rate-limit counter. A window opens on the first
  // message after the previous one lapsed and resets wholesale one interval later.
  // On conflict: if the stored window has lapsed (now >= window_start + interval),
  // open a fresh window at `now` seeded with this call's credits; otherwise keep the
  // anchor and accumulate. `?` order: user_id, window_type, credits, interval, interval
  // (interval e.g. '+1 day' / '+7 days'). 'now' is fixed within a statement, so all
  // three references agree. NOTE: the `tokens` column stores CREDITS (issue #211).
  UPSERT_WINDOW: `
    INSERT INTO AiRateLimitWindow (user_id, window_type, window_start, tokens)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(user_id, window_type) DO UPDATE SET
      tokens = CASE
        WHEN datetime('now') >= datetime(window_start, ?) THEN excluded.tokens
        ELSE tokens + excluded.tokens
      END,
      window_start = CASE
        WHEN datetime('now') >= datetime(window_start, ?) THEN excluded.window_start
        ELSE window_start
      END
  `,
  // Current-window tokens (0 once the window has lapsed) and the reset instant
  // (window_start + interval, NULL when lapsed). A missing row means no window yet.
  // `?` order: negInterval, negInterval, posInterval, user_id, window_type
  // (negInterval e.g. '-1 day' / '-7 days'; posInterval '+1 day' / '+7 days').
  GET_WINDOW: `
    SELECT
      CASE WHEN window_start > datetime('now', ?) THEN tokens ELSE 0 END AS tokens,
      CASE WHEN window_start > datetime('now', ?) THEN datetime(window_start, ?) ELSE NULL END AS reset_at
    FROM AiRateLimitWindow
    WHERE user_id = ? AND window_type = ?
  `,
  CREATE_INDEX_USER_CREATED: `
    CREATE INDEX IF NOT EXISTS idx_aiusage_user_created ON AiUsage (user_id, created_at)
  `,
};

export default aiUsageQueries;
