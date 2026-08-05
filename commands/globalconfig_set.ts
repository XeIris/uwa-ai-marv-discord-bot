import { DevCommand } from './classes/DevCommand';
import {
  SETTABLE_GLOBAL_VALUE_KEYS,
  validateGlobalConfigValue,
} from '../utils/globalConfig';

class GlobalConfigSet extends DevCommand {
  constructor(client: any) {
    super(client, 'set', 'Set a global config value', [
      {
        name: 'key',
        description: 'Config key',
        type: 3,
        required: true,
        choices: SETTABLE_GLOBAL_VALUE_KEYS.map((entry) => ({
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
    ], { isSubcommandOf: 'globalconfig', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value').trim();
    const validationError = validateGlobalConfigValue(key, value);
    if (validationError) {
      await interaction.editReply(validationError);
      return;
    }

    await this.client.db.globalConfig.setGlobalConfig(key, value);
    await interaction.editReply(`\`${key}\` set to \`${value}\`.`);
  }
}

export default GlobalConfigSet;
