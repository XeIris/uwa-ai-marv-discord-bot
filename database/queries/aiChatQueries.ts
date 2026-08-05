const aiChatQueries = {
  // Session management
  START_SESSION: 'INSERT INTO AiChatSession (user_id, persona_name) VALUES (?, ?)',
  // Web-created sessions: explicit source='web' AND active=0 so they never
  // contend with the bot's per-persona active-session unique index.
  START_WEB_SESSION: "INSERT INTO AiChatSession (user_id, persona_name, active, source) VALUES (?, ?, 0, 'web')",
  GET_ACTIVE_SESSION: 'SELECT * FROM AiChatSession WHERE user_id = ? AND persona_name = ? AND active = 1 ORDER BY session_id DESC LIMIT 1',
  GET_SESSION_BY_ID: 'SELECT * FROM AiChatSession WHERE session_id = ?',
  GET_ALL_USER_SESSIONS: `
    SELECT
      s.*,
      COUNT(h.id) AS message_count
    FROM AiChatSession s
    LEFT JOIN AiChatHistory h ON h.session_id = s.session_id
    WHERE s.user_id = ?
    GROUP BY s.session_id
    ORDER BY s.session_id DESC
  `,
  GET_USER_WEB_SESSIONS: `
    SELECT
      s.*,
      COUNT(h.id) AS message_count
    FROM AiChatSession s
    LEFT JOIN AiChatHistory h ON h.session_id = s.session_id
    WHERE s.user_id = ? AND s.source = 'web'
    GROUP BY s.session_id
    ORDER BY s.session_id DESC
  `,
  GET_USER_DISCORD_SESSIONS: `
    SELECT
      s.*,
      COUNT(h.id) AS message_count
    FROM AiChatSession s
    LEFT JOIN AiChatHistory h ON h.session_id = s.session_id
    WHERE s.user_id = ? AND s.source = 'discord'
    GROUP BY s.session_id
    ORDER BY s.session_id DESC
  `,
  END_SESSION: 'UPDATE AiChatSession SET active = 0 WHERE session_id = ?',
  UPDATE_SESSION_TITLE: 'UPDATE AiChatSession SET title = ? WHERE session_id = ? AND title IS NULL',
  RENAME_SESSION: 'UPDATE AiChatSession SET title = ? WHERE session_id = ?',
  ACTIVATE_SESSION: 'UPDATE AiChatSession SET active = 1 WHERE session_id = ?',
  END_ALL_USER_PERSONA_SESSIONS: 'UPDATE AiChatSession SET active = 0 WHERE user_id = ? AND persona_name = ?',

  // History management
  ADD_HISTORY: 'INSERT INTO AiChatHistory (session_id, role, message) VALUES (?, ?, ?)',
  GET_HISTORY: 'SELECT * FROM AiChatHistory WHERE session_id = ? ORDER BY id DESC LIMIT ?',
  DELETE_HISTORY_BY_SESSION: 'DELETE FROM AiChatHistory WHERE session_id = ?',
  DELETE_SESSION: 'DELETE FROM AiChatSession WHERE session_id = ?',
};

export default aiChatQueries;
