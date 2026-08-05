import { Command, CommandArgs } from './Command';
import { log } from '../../utils/log';
import { isDev } from '../../utils/accessControl';

class DevCommand extends Command {
  constructor(client: any, name: string, description: string, options: any[], args: CommandArgs = {}) {
    super(client, name, description, options, args);
  }

  async execute(interaction: any): Promise<void> {
    if (!isDev(interaction)) {
      log(`${interaction.user.username} tried using a dev command smh`);
      if (interaction.deferred) {
        await interaction.editReply('No.');
      } else {
        await interaction.reply('No.');
      }
      return;
    }
    await super.execute(interaction);
  }
}

export { DevCommand };
