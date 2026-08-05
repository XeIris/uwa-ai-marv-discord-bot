const globalConfigQueries = {
  ADD_OR_UPDATE_GLOBAL_CONFIG: 'INSERT OR REPLACE INTO GlobalConfig (key, value) VALUES (?, ?)',
  GET_GLOBAL_CONFIG: 'SELECT key, value FROM GlobalConfig WHERE key = ?',
  GET_ALL_GLOBAL_CONFIG: 'SELECT key, value FROM GlobalConfig',
  DELETE_GLOBAL_CONFIG: 'DELETE FROM GlobalConfig WHERE key = ?',
};

export default globalConfigQueries;
