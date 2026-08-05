import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { logError } from '../utils/log';
import { generateTitleForHistory } from '../utils/ai';

class AiRetitle extends Command {
  constructor(client: any) {
    super(client, 'retitle', 'Regenerate the title for one or all of your AI chat sessions', [
      {
        name: 'session_id',
        description: 'Session ID to retitle (from /ai view). Omit to retitle all Discord sessions.',
        type: 4,
        required: false,
      },
    ], {
      isSubcommandOf: 'ai',
      blame: 'both',
    });
  }

  async retitleSession(userId: string, sessionId: number): Promise<{ ok: boolean; title?: string; reason?: string }> {
    const session = await this.client.db.aiChat.getSessionById(sessionId);
    if (!session) return { ok: false, reason: 'not found' };
    if (session.userId !== userId) return { ok: false, reason: 'access denied' };

    const history = await this.client.db.aiChat.getHistory(sessionId, 100);
    const title = await generateTitleForHistory(history);
    if (!title) return { ok: false, reason: 'no conversation to title' };

    const saved = await this.client.db.aiChat.renameSession(userId, sessionId, title);
    if (!saved) return { ok: false, reason: 'failed to save' };

    return { ok: true, title };
  }

  async run(interaction: any): Promise<void> {
    const userId = interaction.user.id;
    const sessionId = interaction.options.getInteger('session_id');

    try {
      if (sessionId !== null) {
        const result = await this.retitleSession(userId, sessionId);

        if (result.reason === 'not found') {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('Session Not Found')
                .setDescription(`No session with ID **${sessionId}** exists.`),
            ],
          });
          return;
        }

        if (result.reason === 'access denied') {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('Access Denied')
                .setDescription('You can only retitle your own sessions.'),
            ],
          });
          return;
        }

        if (!result.ok) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('Could Not Retitle Session')
                .setDescription('That session has no conversation to generate a title from.'),
            ],
          });
          return;
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#57F287')
              .setTitle('Title Regenerated')
              .setDescription(`Session **#${sessionId}** is now titled **${result.title}**.`),
          ],
        });
        return;
      }

      const sessions = await this.client.db.aiChat.getUserDiscordSessions(userId);
      if (sessions.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#5865F2')
              .setTitle('No Sessions')
              .setDescription("You don't have any Discord AI sessions to retitle."),
          ],
        });
        return;
      }

      let updated = 0;
      let skipped = 0;
      const updatedLines: string[] = [];

      for (const session of sessions) {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.retitleSession(userId, session.sessionId);
        if (result.ok && result.title) {
          updated += 1;
          if (updatedLines.length < 10) {
            updatedLines.push(`**#${session.sessionId}** → ${result.title}`);
          }
        } else {
          skipped += 1;
        }
      }

      const lines = [
        `Retitled **${updated}** session${updated === 1 ? '' : 's'}.`,
        skipped > 0 ? `Skipped **${skipped}** session${skipped === 1 ? '' : 's'} with no titleable conversation.` : null,
        updatedLines.length > 0 ? `\n${updatedLines.join('\n')}` : null,
        updated > updatedLines.length ? `\n*…and ${updated - updatedLines.length} more.*` : null,
      ].filter(Boolean);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(updated > 0 ? '#57F287' : '#FEE75C')
            .setTitle('Titles Regenerated')
            .setDescription(lines.join('\n')),
        ],
      });
    } catch (err) {
      logError('AiRetitle error:', err);
      await interaction.editReply({ content: 'Failed to regenerate session title(s). Please try again.' });
    }
  }
}

export default AiRetitle;
