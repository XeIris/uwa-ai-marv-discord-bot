import { log } from '../../utils/log';
import commandConfigQueries from '../queries/commandConfigQueries';
import type Database from '../Database';

class CommandConfigModel {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  async addOrUpdateCommandBlacklist(commandName: string, serverId: string, reason: string): Promise<void> {
    const query = commandConfigQueries.ADD_OR_UPDATE_COMMAND_BLACKLIST;
    await this.db.executeQuery(query, [commandName, serverId, reason]);
    log(`Added or updated blacklist for command: ${commandName} in server: ${serverId}`);
  }

  async getBlacklistedCommands(serverId: string): Promise<Record<string, any>[]> {
    const query = commandConfigQueries.GET_BLACKLISTED_COMMANDS;
    return this.db.executeSelectAllQuery(query, [serverId]);
  }

  async deleteCommandBlacklist(commandName: string, serverId: string): Promise<string> {
    const query = commandConfigQueries.DELETE_COMMAND_BLACKLIST;
    const result = await this.db.executeQuery(query, [commandName, serverId]);
    if (result.changes > 0) {
      log(`Deleted blacklist entry for command: ${commandName} in server: ${serverId}`);
      return `Successfully deleted the blacklist entry for command: ${commandName}`;
    }
    log(`No blacklist entry found for command: ${commandName} in server: ${serverId}`);
    return `No blacklist entry found for command: ${commandName}`;
  }

  async isCommandBlacklisted(commandName: string, serverId: string): Promise<boolean> {
    const blacklist = await this.getBlacklistedCommands(serverId);
    return blacklist.some((command) => command.commandName === commandName);
  }
}

export default CommandConfigModel;
