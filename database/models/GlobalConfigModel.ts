import globalConfigQueries from '../queries/globalConfigQueries';
import type Database from '../Database';

class GlobalConfigModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  async setGlobalConfig(key: string, value: string): Promise<void> {
    const query = globalConfigQueries.ADD_OR_UPDATE_GLOBAL_CONFIG;
    await this.db.executeQuery(query, [key, value]);
  }

  async getGlobalConfig(key: string): Promise<string | null> {
    const query = globalConfigQueries.GET_GLOBAL_CONFIG;
    const result = await this.db.executeSelectQuery(query, [key]);
    return result ? result.value : null;
  }

  async getAllGlobalConfig(): Promise<Record<string, any>[]> {
    const query = globalConfigQueries.GET_ALL_GLOBAL_CONFIG;
    return this.db.executeSelectAllQuery(query);
  }

  async deleteGlobalConfig(key: string): Promise<void> {
    const query = globalConfigQueries.DELETE_GLOBAL_CONFIG;
    await this.db.executeQuery(query, [key]);
  }

  /**
   * Appends a value to a comma-separated list stored under `key`, within a transaction.
   * Returns true if the value was added, false if it was already present.
   */
  async appendUniqueToList(key: string, value: string): Promise<boolean> {
    return this.db.executeTransaction(async () => {
      const existing = await this.getGlobalConfig(key);
      const items = existing ? existing.split(',').map((s) => s.trim()).filter(Boolean) : [];

      if (items.includes(value)) return false;

      items.push(value);
      await this.setGlobalConfig(key, items.join(','));
      return true;
    });
  }

  /**
   * Removes a value from a comma-separated list stored under `key`, within a transaction.
   * Returns true if the value was removed, false if it was not present.
   */
  async removeFromList(key: string, value: string): Promise<boolean> {
    return this.db.executeTransaction(async () => {
      const existing = await this.getGlobalConfig(key);
      const items = existing ? existing.split(',').map((s) => s.trim()).filter(Boolean) : [];

      if (!items.includes(value)) return false;

      const updated = items.filter((id) => id !== value);
      if (updated.length > 0) {
        await this.setGlobalConfig(key, updated.join(','));
      } else {
        await this.deleteGlobalConfig(key);
      }
      return true;
    });
  }
}

export default GlobalConfigModel;
