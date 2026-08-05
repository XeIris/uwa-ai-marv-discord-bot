import { DevCommand } from './classes/DevCommand';
import { log } from '../utils/log';
import { clearCachedAllowedServers } from '../utils/accessControl';

class ServerRegister extends DevCommand {
  constructor(client: any) {
    super(client, 'register', 'Register this server for bot commands', [], { isSubcommandOf: 'server', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;

    const added = await this.client.db.globalConfig.appendUniqueToList('allowed_servers', guildId);

    if (!added) {
      await interaction.editReply(`Server **${guildName}** (\`${guildId}\`) is already registered.`);
      return;
    }

    clearCachedAllowedServers();
    log(`Registered server ${guildName} (${guildId}) to allowed_servers`);

    await interaction.editReply(`Server **${guildName}** (\`${guildId}\`) registered. Re-registering commands...`);

    // Re-register commands so the guild gets its commands immediately
    await this.client.registerCommands(this.client.user.id);
    await interaction.followUp(`Commands registered for **${guildName}**.`);
  }
}

export default ServerRegister;
