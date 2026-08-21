import { AdminCommand } from './classes/AdminCommand';
import { respondWithEventChoices } from '../utils/eventOptions';

class EventDelete extends AdminCommand {
  constructor(client: any) {
    super(client, 'delete', 'Remove an event from the club calendar', [
      {
        name: 'event', description: 'Which event to delete', type: 4, required: true, autocomplete: true,
      },
    ], { isSubcommandOf: 'event' });
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

    // Queued inside the delete's transaction, before the subscriptions cascaded
    // away — so this counts people who will hear it was cancelled.
    const notices = await this.client.db.eventNotice.listForEvent(id);
    const notified = notices.filter((notice: any) => notice.target === 'dm' && notice.sentAt === null).length;

    const suffix = notified > 0
      ? ` I'll let ${notified} subscriber${notified === 1 ? '' : 's'} know it's cancelled, and post it to the reminder channels.`
      : '';
    await interaction.editReply(`Deleted **${existing.name}** (id \`${id}\`).${suffix}`);
  }
}

export default EventDelete;
