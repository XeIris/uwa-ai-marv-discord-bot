import { EmbedBuilder } from 'discord.js';
import { AdminCommand } from './classes/AdminCommand';
import { discordTimestamp, parsePerthDateTime, TIME_FORMAT_HINT } from '../utils/clubInfo';
import { IMAGE_KEEP_WARNING, validateImageAttachment } from '../utils/eventImage';
import { logError } from '../utils/log';

class EventAdd extends AdminCommand {
  constructor(client: any) {
    super(client, 'add', 'Add an event to the club calendar', [
      {
        name: 'name', description: 'Event name', type: 3, required: true,
      },
      {
        name: 'start', description: 'Start time, Perth time: YYYY-MM-DD HH:MM', type: 3, required: true,
      },
      { name: 'end', description: 'End time, Perth time: YYYY-MM-DD HH:MM', type: 3 },
      { name: 'location', description: 'Where it happens', type: 3 },
      { name: 'description', description: 'What it is', type: 3 },
      { name: 'url', description: 'Link (signup, event page, etc.)', type: 3 },
      { name: 'image', description: 'Poster/flyer image for the event', type: 11 },
    ], { isSubcommandOf: 'event' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const name = interaction.options.getString('name').trim();
    if (name.length === 0 || name.length > 100) {
      await interaction.editReply('Event name must be 1-100 characters.');
      return;
    }

    const startsAt = parsePerthDateTime(interaction.options.getString('start'));
    if (!startsAt) {
      await interaction.editReply(`Couldn't read that start time. ${TIME_FORMAT_HINT}`);
      return;
    }

    const rawEnd = interaction.options.getString('end');
    const endsAt = rawEnd === null ? null : parsePerthDateTime(rawEnd);
    if (rawEnd !== null && !endsAt) {
      await interaction.editReply(`Couldn't read that end time. ${TIME_FORMAT_HINT}`);
      return;
    }
    if (endsAt && endsAt.getTime() < startsAt.getTime()) {
      await interaction.editReply('The end time is before the start time.');
      return;
    }

    const image = interaction.options.getAttachment('image');
    const imageError = validateImageAttachment(image);
    if (imageError) {
      await interaction.editReply(imageError);
      return;
    }

    const id = await this.client.db.event.create(interaction.guild.id, {
      name,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
      location: interaction.options.getString('location'),
      description: interaction.options.getString('description'),
      url: interaction.options.getString('url'),
    }, interaction.user.id);

    const lines = [
      `${discordTimestamp(startsAt.toISOString())} (${discordTimestamp(startsAt.toISOString(), 'R')})`,
      `id \`${id}\``,
    ];
    if (image) lines.push('', IMAGE_KEEP_WARNING);

    const embed = new EmbedBuilder()
      .setTitle(`Event added — ${name}`)
      .setDescription(lines.join('\n'))
      .setColor('#00FF00');

    // Re-upload the image on our own confirmation message, then store a
    // reference to THAT message. Discord CDN links expire, so the durable
    // handle is (channel, message, attachment) — see utils/eventImage.ts.
    const reply = await interaction.editReply({
      embeds: [embed],
      files: image ? [{ attachment: image.url, name: image.name }] : [],
    });

    if (image) {
      const stored = [...(reply.attachments?.values() ?? [])][0];
      if (stored) {
        try {
          await this.client.db.event.setImage(interaction.guild.id, id, {
            channelId: reply.channelId ?? interaction.channelId,
            messageId: reply.id,
            attachmentId: stored.id,
          });
        } catch (err) {
          logError(`Event ${id}: failed to store image reference:`, err);
          await interaction.followUp({
            content: 'The event was created, but I couldn\'t save its image reference. Re-add the image with `/event setimage`.',
            ephemeral: true,
          });
        }
      } else {
        logError(`Event ${id}: confirmation reply carried no attachment; image not stored`);
      }
    }
  }
}

export default EventAdd;
