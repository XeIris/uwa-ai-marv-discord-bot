import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { OFFICIAL_LINKS, UWA_LINKS, formatLinkList } from '../utils/clubLinks';

/**
 * Everything here is public, so this is a plain Command with no gating — the
 * whole point is that anyone can grab the invite or the sign-up link. Answers
 * from a static list rather than asking Marv, so it costs no AI credits.
 */
class Links extends Command {
  constructor(client: any) {
    super(client, 'links', 'Official UWA AI Club links — joining, socials, Discord invite', []);
  }

  async run(interaction: any): Promise<void> {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('UWA AI Club — official links')
          .setDescription(formatLinkList(OFFICIAL_LINKS))
          .addFields({ name: 'UWA resources (not run by the club)', value: formatLinkList(UWA_LINKS) })
          .setFooter({ text: 'Guild membership is what makes you a member — the Discord is free to join.' })
          .setColor('#5865F2'),
      ],
    });
  }
}

export default Links;
