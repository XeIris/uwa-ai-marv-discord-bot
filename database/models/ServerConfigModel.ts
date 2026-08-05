import serverConfigQueries from '../queries/serverConfigQueries';
import { serverRoleKey, SERVER_ROLE_KEY_PREFIX } from '../../utils/serverConfig';
import type Database from '../Database';

class ServerConfigModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  async setServerConfig(serverId: string, key: string, value: string): Promise<void> {
    const query = serverConfigQueries.ADD_OR_UPDATE_SERVER_CONFIG;
    await this.db.executeQuery(query, [serverId, key, value]);
  }

  async getServerConfig(serverId: string, key: string): Promise<string | null> {
    const query = serverConfigQueries.GET_SERVER_CONFIG;
    const result = await this.db.executeSelectQuery(query, [serverId, key]);
    return result ? result.value : null;
  }

  async getAllServerConfig(serverId: string): Promise<Record<string, any>[]> {
    const query = serverConfigQueries.GET_ALL_SERVER_CONFIG;
    return this.db.executeSelectAllQuery(query, [serverId]);
  }

  async deleteServerConfig(serverId: string, key: string): Promise<void> {
    const query = serverConfigQueries.DELETE_SERVER_CONFIG;
    await this.db.executeQuery(query, [serverId, key]);
  }

  async appendUniqueToList(serverId: string, key: string, value: string): Promise<boolean> {
    return this.db.executeTransaction(async () => {
      const existing = await this.getServerConfig(serverId, key);
      const items = existing ? existing.split(',').map((s) => s.trim()).filter(Boolean) : [];

      if (items.includes(value)) return false;

      items.push(value);
      await this.setServerConfig(serverId, key, items.join(','));
      return true;
    });
  }

  async removeFromList(serverId: string, key: string, value: string): Promise<boolean> {
    return this.db.executeTransaction(async () => {
      const existing = await this.getServerConfig(serverId, key);
      const items = existing ? existing.split(',').map((s) => s.trim()).filter(Boolean) : [];

      if (!items.includes(value)) return false;

      const updated = items.filter((id) => id !== value);
      if (updated.length > 0) {
        await this.setServerConfig(serverId, key, updated.join(','));
      } else {
        await this.deleteServerConfig(serverId, key);
      }
      return true;
    });
  }

  async setServerRole(serverId: string, roleName: string, roleId: string): Promise<void> {
    await this.setServerConfig(serverId, serverRoleKey(roleName), roleId);
  }

  async getServerRole(serverId: string, roleName: string): Promise<string | null> {
    return this.getServerConfig(serverId, serverRoleKey(roleName));
  }

  async getAllServerRoles(serverId: string): Promise<{ roleName: string; roleId: string }[]> {
    const rows = await this.getAllServerConfig(serverId);
    return rows
      .filter((row) => typeof row.key === 'string' && row.key.startsWith(SERVER_ROLE_KEY_PREFIX))
      .map((row) => ({
        roleName: row.key.slice(SERVER_ROLE_KEY_PREFIX.length),
        roleId: row.value,
      }));
  }

  async removeServerRole(serverId: string, roleName: string): Promise<void> {
    await this.deleteServerConfig(serverId, serverRoleKey(roleName));
  }
}

export default ServerConfigModel;
