import { EmbedBuilder } from 'discord.js';
import { AdminCommand } from './classes/AdminCommand';
import { MAX_TITLE_CHARS, normaliseTitle, resolveDisplayName } from '../utils/committeeOptions';

class CommitteeAdd extends AdminCommand {
  constructor(client: any) {
    super(client, 'add', 'Register a committee member (or give them another title)', [
      {
        name: 'user', description: 'The member to register', type: 6, required: true,
      },
      {
        name: 'title',
        description: `Their role, e.g. "Treasurer" (max ${MAX_TITLE_CHARS} chars)`,
        type: 3,
        required: true,
      },
      { name: 'executive', description: 'Is this an executive position? (default: no)', type: 5 },
      { name: 'order', description: 'Sort order within the section, lower first (default: 100)', type: 4 },
      { name: 'name', description: 'Display name to show (default: their server nickname)', type: 3 },
    ], { isSubcommandOf: 'committee', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const user = interaction.options.getUser('user');
    const title = normaliseTitle(interaction.options.getString('title'));
    if (!title) {
      await interaction.editReply(`Title must be 1-${MAX_TITLE_CHARS} characters.`);
      return;
    }

    const order = interaction.options.getInteger('order');
    if (order !== null && !Number.isInteger(order)) {
      await interaction.editReply('Order must be a whole number.');
      return;
    }

    const displayName = interaction.options.getString('name')?.trim()
      || resolveDisplayName(interaction.options.getMember('user'), user);

    await this.client.db.committee.upsert(interaction.guild.id, user.id, title, {
      displayName,
      isExecutive: interaction.options.getBoolean('executive') === true,
      sortOrder: order ?? 100,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Committee member registered')
          .setDescription(`**${title}** → <@${user.id}> (${displayName})`)
          .setColor('#00FF00'),
      ],
    });
  }
}

export default CommitteeAdd;
