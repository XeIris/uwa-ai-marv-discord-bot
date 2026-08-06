import { AdminCommand } from './classes/AdminCommand';
import { respondWithEventChoices } from '../utils/eventOptions';

class EventDelete extends AdminCommand {
  constructor(client: any) {
    super(client, 'delete', 'Remove an event from the club calendar', [
      {
        name: 'event', description: 'Which event to delete', type: 4, required: true, autocomplete: true,
      },
    ], { isSubcommandOf: 'event', blame: 'ei' });
  }

  async autocomplete(interaction: any): Promise<void> {
    await respondWithEventChoices(this.client, interaction);
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const id = interaction.options.getInteger('event');
    const existing = await this.client.db.event.getById(interaction.guild.id, id);
    if (!existing) {
      await interaction.editReply(`No event with id \`${id}\` in this server.`);
      return;
    }

    await this.client.db.event.delete(interaction.guild.id, id);
    await interaction.editReply(`Deleted **${existing.name}** (id \`${id}\`).`);
  }
}

export default EventDelete;
