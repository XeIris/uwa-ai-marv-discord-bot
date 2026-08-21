import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { logError } from '../utils/log';

/**
 * Withdraws the AI data notice acceptance recorded by utils/aiConsent.ts.
 *
 * Scoped to consent only: it stops the AI talking to you until you accept the
 * notice again, and deliberately doesn't touch stored conversations, since
 * silently deleting someone's chat history behind a command named "forget"
 * would be the surprising reading. `/ai chatdelete` does that, and the reply
 * says so.
 *
 * Ephemeral — a member revoking consent shouldn't have to do it in public.
 */
class AiForget extends Command {
  constructor(client: any) {
    super(client, 'forget', 'Withdraw your agreement to the AI data notice', [], {
      isSubcommandOf: 'ai',
      ephemeral: true,
    });
  }

  async run(interaction: any): Promise<void> {
    const userId = interaction.user.id;

    try {
      const revoked = await this.client.db.aiConsent.revoke(userId);

      if (!revoked) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#99AAB5')
              .setTitle('Nothing to withdraw')
              .setDescription(
                'You haven\'t accepted the AI data notice, so there\'s nothing on '
                + 'record. You\'ll see the notice the next time you talk to the AI.',
              ),
          ],
        });
        return;
      }

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('Agreement withdrawn')
            .setDescription(
              'The AI won\'t reply to you until you accept the notice again — '
              + 'mention it any time to see it.\n\n'
              + 'This only covers your agreement. Conversations already stored are '
              + 'untouched: use `/ai view` to list them and `/ai chatdelete` to '
              + 'delete one permanently.',
            ),
        ],
      });
    } catch (err) {
      logError('AiForget error:', err);
      await interaction.editReply({
        content: 'Failed to withdraw your agreement. Please try again.',
      });
    }
  }
}

export default AiForget;
