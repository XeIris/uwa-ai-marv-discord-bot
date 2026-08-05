const commandConfigQueries = {
  ADD_OR_UPDATE_COMMAND_BLACKLIST: `
    INSERT INTO CommandConfig (command_name, server_id, reason)
    VALUES (?, ?, ?)
    ON CONFLICT(command_name, server_id)
    DO UPDATE SET reason = excluded.reason, disabled_date = CURRENT_TIMESTAMP
  `,
  GET_BLACKLISTED_COMMANDS: 'SELECT * FROM CommandConfig WHERE server_id = ?',
  DELETE_COMMAND_BLACKLIST: 'DELETE FROM CommandConfig WHERE command_name = ? AND server_id = ?',
};

export default commandConfigQueries;
