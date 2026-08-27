const aiToolPreferenceQueries = {
  // Upsert one switch. `tool` is whitelisted against AI_TOOL_KEYS by the model
  // before it gets here; the value still rides as a `?` parameter.
  SET: `
    INSERT INTO AiToolPreference (user_id, tool, enabled, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, tool)
    DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `,
  // Every stored exception for one user. Tools with no row are on by default,
  // so this returns the overrides, not the full picture — see resolveAiTools.
  GET_ALL_FOR_USER: 'SELECT tool, enabled FROM AiToolPreference WHERE user_id = ?',
  GET_ONE: 'SELECT tool, enabled FROM AiToolPreference WHERE user_id = ? AND tool = ?',
};

export default aiToolPreferenceQueries;
