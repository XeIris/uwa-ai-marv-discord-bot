import { DevCommand } from './classes/DevCommand';
import {
  SERVER_CHANNEL_LIST_KEYS,
  validateSettableChannelKey,
} from '../utils/serverConfig';

class ServerConfigSetChannel extends DevCommand {
  constructor(client: any) {
    super(client, 'setchannel', 'Toggle a channel in a server channel list', [
      {
        name: 'key',
        description: 'Channel list config key',
        type: 3,
        required: true,
        choices: SERVER_CHANNEL_LIST_KEYS.map((key) => ({
          name: key,
          value: key,
        })),
      },
      {
        name: 'channel',
        description: 'The Discord channel',
        type: 7,
        required: true,
        channel_types: [0],
      },
    ], { isSubcommandOf: 'serverconfig', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const key = interaction.options.getString('key');
    const channel = interaction.options.getChannel('channel');
    const serverId = interaction.guild.id;

    const validationError = validateSettableChannelKey(key);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    const added = await this.client.db.serverConfig.appendUniqueToList(serverId, key, channel.id);

    if (added) {
      await interaction.editReply(`Added <#${channel.id}> to \`${key}\`.`);
      return;
    }

    const removed = await this.client.db.serverConfig.removeFromList(serverId, key, channel.id);
    if (removed) {
      await interaction.editReply(`Removed <#${channel.id}> from \`${key}\`.`);
      return;
    }

    await interaction.editReply(`<#${channel.id}> is not in \`${key}\`.`);
  }
}

export default ServerConfigSetChannel;
