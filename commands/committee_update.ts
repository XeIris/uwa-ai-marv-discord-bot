import { EmbedBuilder } from 'discord.js';
import { AdminCommand } from './classes/AdminCommand';
import { MAX_TITLE_CHARS, normaliseTitle, respondWithUserTitles } from '../utils/committeeOptions';

class CommitteeUpdate extends AdminCommand {
  constructor(client: any) {
    super(client, 'update', 'Edit an existing committee entry', [
      {
        name: 'user', description: 'The member whose entry to edit', type: 6, required: true,
      },
      {
        name: 'title',
        description: 'The title they currently hold',
        type: 3,
        required: true,
        autocomplete: true,
      },
      { name: 'new_title', description: `Rename the role (max ${MAX_TITLE_CHARS} chars)`, type: 3 },
      { name: 'executive', description: 'Is this an executive position?', type: 5 },
      { name: 'order', description: 'Sort order within the section, lower first', type: 4 },
      { name: 'name', description: 'Display name to show', type: 3 },
    ], { isSubcommandOf: 'committee', blame: 'ei' });
  }

  async autocomplete(interaction: any): Promise<void> {
    await respondWithUserTitles(this.client, interaction);
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const user = interaction.options.getUser('user');
    const title = normaliseTitle(interaction.options.getString('title'));
    if (!title) {
      await interaction.editReply('That title isn\'t valid.');
      return;
    }

    const rawNewTitle = interaction.options.getString('new_title');
    const newTitle = rawNewTitle === null ? undefined : normaliseTitle(rawNewTitle);
    if (rawNewTitle !== null && !newTitle) {
      await interaction.editReply(`New title must be 1-${MAX_TITLE_CHARS} characters.`);
      return;
    }

    const order = interaction.options.getInteger('order');
    if (order !== null && !Number.isInteger(order)) {
      await interaction.editReply('Order must be a whole number.');
      return;
    }

    const executive = interaction.options.getBoolean('executive');
    const displayName = interaction.options.getString('name')?.trim();

    const updated = await this.client.db.committee.updateEntry(interaction.guild.id, user.id, title, {
      title: newTitle,
      displayName: displayName === undefined ? undefined : displayName,
      isExecutive: executive === null ? undefined : executive,
      sortOrder: order === null ? undefined : order,
    });

    if (!updated) {
      await interaction.editReply({
        content: `<@${user.id}> doesn't hold **${title}** — add it with \`/committee add\` first.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Committee entry updated')
          .setDescription(`<@${user.id}> — **${newTitle ?? title}**`)
          .setColor('#00AA00'),
      ],
    });
  }
}

export default CommitteeUpdate;
