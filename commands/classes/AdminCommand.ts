import { Command, CommandArgs } from './Command';
import { log } from '../../utils/log';
import { isAdmin } from '../../utils/accessControl';

/**
 * A command only guild administrators (or bot devs) may run. Unlike DevCommand
 * this is for server-side content that club admins own — the committee roster,
 * the events calendar — not for bot internals.
 */
class AdminCommand extends Command {
  constructor(client: any, name: string, description: string, options: any[], args: CommandArgs = {}) {
    super(client, name, description, options, args);
  }

  async execute(interaction: any): Promise<void> {
    if (!isAdmin(interaction)) {
      log(`${interaction.user.username} tried using an admin command without permission`);
      const message = 'You need the Administrator permission to use this command.';
      if (interaction.deferred) {
        await interaction.editReply(message);
      } else {
        await interaction.reply(message);
      }
      return;
    }
    await super.execute(interaction);
  }
}

export { AdminCommand };
