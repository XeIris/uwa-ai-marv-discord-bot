import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { logError } from '../utils/log';

/**
 * Marv is the only invokable persona, so this takes no arguments — a required
 * option with exactly one choice is dead UI. Equivalent to sending `marv -n`.
 */
const PERSONA_NAME = 'Marv';

class AiChatnew extends Command {
  constructor(client: any) {
    super(client, 'chatnew', 'Start a new chat session with Marv', [], {
      isSubcommandOf: 'ai',
    });
  }

  async run(interaction: any): Promise<void> {
    const userId = interaction.user.id;

    try {
      const session = await this.client.db.aiChat.startNewSession(userId, PERSONA_NAME);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('New Session Started')
            .setDescription(
              `Started a new **${PERSONA_NAME}** chat session: **#${session.sessionId}**.\n`
              + 'Saying `marv` will now continue this new conversation.',
            ),
        ],
      });
    } catch (err) {
      logError('AiChatnew error:', err);
      await interaction.editReply({ content: 'Failed to start a new chat session. Please try again.' });
    }
  }
}

export default AiChatnew;
