import { REST, Routes } from 'discord.js';
import { DevCommand } from './classes/DevCommand';
import { log } from '../utils/log';
import { clearCachedAllowedServers } from '../utils/accessControl';

class ServerUnregister extends DevCommand {
  constructor(client: any) {
    super(client, 'unregister', 'Unregister this server from bot commands', [], { isSubcommandOf: 'server', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;

    const removed = await this.client.db.globalConfig.removeFromList('allowed_servers', guildId);

    if (!removed) {
      await interaction.editReply(`Server **${guildName}** (\`${guildId}\`) is not registered.`);
      return;
    }

    clearCachedAllowedServers();
    log(`Unregistered server ${guildName} (${guildId}) from allowed_servers`);

    // Clear guild-specific commands for this server
    const rest = new REST({ version: '10' }).setToken(this.client.token);
    await rest.put(Routes.applicationGuildCommands(this.client.user.id, guildId), { body: [] });

    await interaction.editReply(`Server **${guildName}** (\`${guildId}\`) unregistered and commands removed.`);

    // Re-register remaining servers (or go back to global /server only)
    await this.client.registerCommands(this.client.user.id);
  }
}

export default ServerUnregister;
