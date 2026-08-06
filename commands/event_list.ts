import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { formatEventList } from '../utils/clubInfo';

/** Read-only, so this is a plain Command — anyone can check what's coming up. */
class EventList extends Command {
  constructor(client: any) {
    super(client, 'list', 'Show the club events calendar', [
      { name: 'include_past', description: 'Also show events that have already happened', type: 5 },
    ], { isSubcommandOf: 'event' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const includePast = interaction.options.getBoolean('include_past') === true;
    const events = includePast
      ? await this.client.db.event.listAll(interaction.guild.id)
      : await this.client.db.event.listUpcoming(interaction.guild.id);

    const body = events.length === 0 && !includePast
      ? 'No upcoming events. Run with `include_past: true` to see previous ones.'
      : formatEventList(events);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(includePast ? `All events — ${interaction.guild.name}` : `Upcoming events — ${interaction.guild.name}`)
          .setDescription(body.slice(0, 4096))
          .setColor('#00AA00'),
      ],
    });
  }
}

export default EventList;
