import { EmbedBuilder } from 'discord.js';
import { DevCommand } from './classes/DevCommand';
import { formatServerConfigOverview } from '../utils/serverConfig';

class ServerConfigGet extends DevCommand {
  constructor(client: any) {
    super(client, 'get', 'List all settable server config values for this guild', [], {
      isSubcommandOf: 'serverconfig',
      blame: 'ei',
    });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const rows = await this.client.db.serverConfig.getAllServerConfig(interaction.guild.id);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Server config — ${interaction.guild.name}`)
          .setDescription(formatServerConfigOverview(rows))
          .setColor('#00AA00'),
      ],
    });
  }
}

export default ServerConfigGet;
