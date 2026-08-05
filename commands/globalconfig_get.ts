import { EmbedBuilder } from 'discord.js';
import { DevCommand } from './classes/DevCommand';
import { formatGlobalConfigOverview } from '../utils/globalConfig';

class GlobalConfigGet extends DevCommand {
  constructor(client: any) {
    super(client, 'get', 'List all documented global config values', [], {
      isSubcommandOf: 'globalconfig',
      blame: 'ei',
    });
  }

  async run(interaction: any): Promise<void> {
    const rows = await this.client.db.globalConfig.getAllGlobalConfig();

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Global config')
          .setDescription(formatGlobalConfigOverview(rows))
          .setColor('#00AA00'),
      ],
    });
  }
}

export default GlobalConfigGet;
