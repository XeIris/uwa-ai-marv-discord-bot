const serverConfigQueries = {
  ADD_OR_UPDATE_SERVER_CONFIG: 'INSERT OR REPLACE INTO ServerConfig (server_id, key, value) VALUES (?, ?, ?)',
  GET_SERVER_CONFIG: 'SELECT key, value FROM ServerConfig WHERE server_id = ? AND key = ?',
  GET_ALL_SERVER_CONFIG: 'SELECT key, value FROM ServerConfig WHERE server_id = ?',
  DELETE_SERVER_CONFIG: 'DELETE FROM ServerConfig WHERE server_id = ? AND key = ?',
  COUNT_LEGACY_SERVER_ROLES: 'SELECT COUNT(*) AS count FROM ServerRoles',
  MIGRATE_FROM_SERVER_ROLES: `
    INSERT OR REPLACE INTO ServerConfig (server_id, key, value)
    SELECT server_id, 'role:' || role_name, role_id FROM ServerRoles
    WHERE server_id IS NOT NULL
  `,
  COUNT_UNMIGRATED_SERVER_ROLES: `
    SELECT COUNT(*) AS count FROM ServerRoles sr
    WHERE sr.server_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ServerConfig sc
        WHERE sc.server_id = sr.server_id
          AND sc.key = 'role:' || sr.role_name
          AND sc.value = sr.role_id
      )
  `,
  DROP_LEGACY_SERVER_ROLES: 'DROP TABLE ServerRoles',
};

export default serverConfigQueries;
