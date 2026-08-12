import { EmbedBuilder } from 'discord.js';
import { AdminCommand } from './classes/AdminCommand';
import { IMAGE_KEEP_WARNING, validateImageAttachment } from '../utils/eventImage';
import { respondWithEventChoices } from '../utils/eventOptions';

/**
 * Sets or replaces an event's image after creation. Same durability trick as
 * `/event add`: the image is re-uploaded onto this command's own confirmation
 * message and the event stores a reference to that message, because raw Discord
 * CDN links expire (see utils/eventImage.ts).
 */
class EventSetImage extends AdminCommand {
  constructor(client: any) {
    super(client, 'setimage', 'Set or replace an event\'s image', [
      {
        name: 'event', description: 'Which event to update', type: 4, required: true, autocomplete: true,
      },
      { name: 'image', description: 'Poster/flyer image (omit to remove the current one)', type: 11 },
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
    const event = await this.client.db.event.getById(interaction.guild.id, id);
    if (!event) {
      await interaction.editReply(`No event with id \`${id}\` in this server.`);
      return;
    }

    const image = interaction.options.getAttachment('image');
    if (!image) {
      await this.client.db.event.clearImage(interaction.guild.id, id);
      await interaction.editReply(`Removed the image from **${event.name}** (id \`${id}\`).`);
      return;
    }

    const imageError = validateImageAttachment(image);
    if (imageError) {
      await interaction.editReply(imageError);
      return;
    }

    const reply = await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Image set — ${event.name}`)
          .setDescription(`id \`${id}\`\n\n${IMAGE_KEEP_WARNING}`)
          .setColor('#00FF00'),
      ],
      files: [{ attachment: image.url, name: image.name }],
    });

    const stored = [...(reply.attachments?.values() ?? [])][0];
    if (!stored) {
      await interaction.followUp({ content: 'Discord didn\'t return the uploaded attachment — try again.', ephemeral: true });
      return;
    }

    await this.client.db.event.setImage(interaction.guild.id, id, {
      channelId: reply.channelId ?? interaction.channelId,
      messageId: reply.id,
      attachmentId: stored.id,
    });
  }
}

export default EventSetImage;
