import * as Discord from 'discord.js';
import { DevCommand } from './classes/DevCommand';
import { logError } from '../utils/log';

class BlacklistView extends DevCommand {
  constructor(client: any) {
    super(client, 'view', 'Retrieve blacklisted commands for a specific server', [
      {
        name: 'server',
        description: 'The ID of the server to retrieve blacklisted commands for',
        type: 3,
        required: true,
      },
    ], { isSubcommandOf: 'blacklist', blame: 'xei' });
  }

  async run(interaction: any): Promise<void> {
    const serverId = interaction.options.getString('server');

    try {
      const blacklistedCommands = await this.client.db.commandConfig.getBlacklistedCommands(serverId);

      if (blacklistedCommands.length === 0) {
        await interaction.editReply({
          embeds: [
            new Discord.EmbedBuilder()
              .setColor('#00AA00')
              .setTitle('No Blacklisted Commands')
              .setDescription(`There are no blacklisted commands for server: **${serverId}**.`),
          ],
        });
        return;
      }

      const formattedCommands = blacklistedCommands.map((cmd: any, index: number) => `**${index + 1}. Command**: ${cmd.commandName}\n**Reason**: ${cmd.reason || 'No reason provided'}\n**Date Disabled**: ${cmd.disabled_date}`).join('\n\n');

      await interaction.editReply({
        embeds: [
          new Discord.EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(`Blacklisted Commands for Server: ${serverId}`)
            .setDescription(formattedCommands),
        ],
      });
    } catch (err) {
      logError('Failed to retrieve blacklisted commands:', err);

      await interaction.editReply({
        embeds: [
          new Discord.EmbedBuilder()
            .setColor('#AA0000')
            .setTitle('Failed to retrieve blacklisted commands')
            .setDescription(`An error occurred while retrieving blacklisted commands for server: **${serverId}**. Please try again.`),
        ],
      });
    }
  }
}

export default BlacklistView;
