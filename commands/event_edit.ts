import { EmbedBuilder } from 'discord.js';
import { AdminCommand } from './classes/AdminCommand';
import { discordTimestamp, parsePerthDateTime, TIME_FORMAT_HINT } from '../utils/clubInfo';
import { respondWithEventChoices } from '../utils/eventOptions';

class EventEdit extends AdminCommand {
  constructor(client: any) {
    super(client, 'edit', 'Edit an event on the club calendar', [
      {
        name: 'event', description: 'Which event to edit', type: 4, required: true, autocomplete: true,
      },
      { name: 'name', description: 'Event name', type: 3 },
      { name: 'start', description: 'Start time, Perth time: YYYY-MM-DD HH:MM', type: 3 },
      { name: 'end', description: 'End time, Perth time: YYYY-MM-DD HH:MM (use "none" to clear)', type: 3 },
      { name: 'location', description: 'Where it happens (use "none" to clear)', type: 3 },
      { name: 'description', description: 'What it is (use "none" to clear)', type: 3 },
      { name: 'url', description: 'Link (use "none" to clear)', type: 3 },
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

    // `none` is the escape hatch for clearing an optional field; a missing option
    // leaves the stored value alone.
    const optionalText = (option: string): string | null | undefined => {
      const raw = interaction.options.getString(option);
      if (raw === null) return undefined;
      const trimmed = raw.trim();
      return trimmed.toLowerCase() === 'none' ? null : trimmed;
    };

    const rawName = interaction.options.getString('name');
    if (rawName !== null && (rawName.trim().length === 0 || rawName.trim().length > 100)) {
      await interaction.editReply('Event name must be 1-100 characters.');
      return;
    }

    const rawStart = interaction.options.getString('start');
    const startsAt = rawStart === null ? undefined : parsePerthDateTime(rawStart);
    if (rawStart !== null && !startsAt) {
      await interaction.editReply(`Couldn't read that start time. ${TIME_FORMAT_HINT}`);
      return;
    }

    const rawEnd = interaction.options.getString('end');
    let endsAt: string | null | undefined;
    if (rawEnd === null) {
      endsAt = undefined;
    } else if (rawEnd.trim().toLowerCase() === 'none') {
      endsAt = null;
    } else {
      const parsed = parsePerthDateTime(rawEnd);
      if (!parsed) {
        await interaction.editReply(`Couldn't read that end time. ${TIME_FORMAT_HINT}`);
        return;
      }
      endsAt = parsed.toISOString();
    }

    const finalStart = startsAt ? startsAt.toISOString() : existing.startsAt;
    const finalEnd = endsAt === undefined ? existing.endsAt : endsAt;
    if (finalEnd && new Date(finalEnd).getTime() < new Date(finalStart).getTime()) {
      await interaction.editReply('The end time is before the start time.');
      return;
    }

    const updated = await this.client.db.event.update(interaction.guild.id, id, {
      name: rawName === null ? undefined : rawName.trim(),
      startsAt: startsAt ? startsAt.toISOString() : undefined,
      endsAt,
      location: optionalText('location'),
      description: optionalText('description'),
      url: optionalText('url'),
    });

    if (!updated) {
      await interaction.editReply('Nothing was changed.');
      return;
    }

    const fresh = await this.client.db.event.getById(interaction.guild.id, id);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Event updated — ${fresh.name}`)
          .setDescription(`${discordTimestamp(fresh.startsAt)} (${discordTimestamp(fresh.startsAt, 'R')})\nid \`${id}\``)
          .setColor('#00AA00'),
      ],
    });
  }
}

export default EventEdit;
