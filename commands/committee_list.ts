import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { formatCommitteeRoster } from '../utils/clubInfo';

/** Read-only, so this is a plain Command — anyone can look the roster up. */
class CommitteeList extends Command {
  constructor(client: any) {
    super(client, 'list', 'Show the club committee roster', [], {
      isSubcommandOf: 'committee',
      blame: 'ei',
    });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const entries = await this.client.db.committee.listByServer(interaction.guild.id);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Committee — ${interaction.guild.name}`)
          .setDescription(formatCommitteeRoster(entries))
          .setColor('#00AA00'),
      ],
      allowedMentions: { parse: [] },
    });
  }
}

export default CommitteeList;
