import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { logError } from '../utils/log';

class AiChatswitch extends Command {
  constructor(client: any) {
    super(client, 'chatswitch', 'Switch to a previous AI chat session by its ID', [
      {
        name: 'session_id',
        description: 'The session ID to switch to (visible in /ai view)',
        type: 4,
        required: true,
      },
    ], {
      isSubcommandOf: 'ai',
      blame: 'xei',
    });
  }

  async run(interaction: any): Promise<void> {
    const userId = interaction.user.id;
    const sessionId = interaction.options.getInteger('session_id');

    try {
      const session = await this.client.db.aiChat.getSessionById(sessionId);

      if (!session) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#ED4245')
              .setTitle('❌ Session Not Found')
              .setDescription(`No session with ID **${sessionId}** exists.`),
          ],
        });
        return;
      }

      if (session.userId !== userId) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#ED4245')
              .setTitle('❌ Access Denied')
              .setDescription('You can only switch to your own sessions.'),
          ],
        });
        return;
      }

      await this.client.db.aiChat.switchSession(userId, sessionId);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ Session Switched')
            .setDescription(
              `Switched to session **#${sessionId}** (${session.personaName}).\n`
              + `Mentioning \`@${session.personaName.toLowerCase()}\` will now continue from this conversation.`,
            ),
        ],
      });
    } catch (err) {
      logError('AiChatswitch error:', err);
      await interaction.editReply({ content: 'Failed to switch session. Please try again.' });
    }
  }
}

export default AiChatswitch;
