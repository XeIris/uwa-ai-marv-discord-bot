import { DevCommand } from './classes/DevCommand';
import {
  SETTABLE_VALUE_KEYS,
  validateServerConfigValue,
} from '../utils/serverConfig';

class ServerConfigSetValue extends DevCommand {
  constructor(client: any) {
    super(client, 'setvalue', 'Set a numeric server config value', [
      {
        name: 'key',
        description: 'Config key',
        type: 3,
        required: true,
        choices: SETTABLE_VALUE_KEYS.map((entry) => ({
          name: entry.key,
          value: entry.key,
        })),
      },
      {
        name: 'value',
        description: 'Config value',
        type: 3,
        required: true,
      },
    ], { isSubcommandOf: 'serverconfig', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value').trim();
    const validationError = validateServerConfigValue(key, value);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    await this.client.db.serverConfig.setServerConfig(interaction.guild.id, key, value);
    await interaction.editReply(`\`${key}\` set to \`${value}\` for **${interaction.guild.name}**.`);
  }
}

export default ServerConfigSetValue;
