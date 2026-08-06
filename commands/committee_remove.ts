import { AdminCommand } from './classes/AdminCommand';
import { normaliseTitle, respondWithUserTitles } from '../utils/committeeOptions';

class CommitteeRemove extends AdminCommand {
  constructor(client: any) {
    super(client, 'remove', 'Remove a committee title (or every title a member holds)', [
      {
        name: 'user', description: 'The member to remove', type: 6, required: true,
      },
      {
        name: 'title',
        description: 'Which title to remove — leave blank to remove all of them',
        type: 3,
        autocomplete: true,
      },
    ], { isSubcommandOf: 'committee' });
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
    const rawTitle = interaction.options.getString('title');
    const title = rawTitle === null ? undefined : normaliseTitle(rawTitle);
    if (rawTitle !== null && !title) {
      await interaction.editReply('That title isn\'t valid.');
      return;
    }

    const removed = await this.client.db.committee.remove(interaction.guild.id, user.id, title);
    if (removed === 0) {
      await interaction.editReply(
        title
          ? `<@${user.id}> doesn't hold **${title}**.`
          : `<@${user.id}> isn't on the committee.`,
      );
      return;
    }

    await interaction.editReply({
      content: title
        ? `Removed **${title}** from <@${user.id}>.`
        : `Removed <@${user.id}> from the committee (${removed} title(s)).`,
      allowedMentions: { parse: [] },
    });
  }
}

export default CommitteeRemove;
