import { DevCommand } from './classes/DevCommand';
import { buildWelcomePayload } from '../classes/handlers/welcomeHandler';
import { logError } from '../utils/log';

/**
 * Dev diagnostic: renders the join-welcome card for yourself and shows it back,
 * ephemerally, right where you ran it.
 *
 * Deliberately does not post to the configured `welcome_channels` — the point is
 * to check the render works (fonts present, art present, avatar fetched) without
 * staging a fake join in front of the server. That also means it works before
 * the channel list is configured at all.
 */
class WelcomeTest extends DevCommand {
  constructor(client: any) {
    super(client, 'welcome_test', 'preview the join-welcome card for yourself (only you see it)', [
      {
        name: 'user',
        description: 'Render the card for someone else instead of yourself',
        type: 6,
        required: false,
      },
    ], {
      isSubcommandOf: 'dev',
      ephemeral: true,
    });
  }

  async run(interaction: any): Promise<void> {
    try {
      const user = interaction.options.getUser('user') ?? interaction.user;
      // The member carries the per-guild nickname, which is what a real join
      // would show; fall back to the global user when they aren't in the guild.
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      const payload = await buildWelcomePayload({
        id: user.id,
        displayName: member?.displayName ?? user.displayName ?? user.username,
        avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 512 }),
      });

      await interaction.editReply({
        // No `content` from the payload: that greeting pings the member, and a
        // rehearsal shouldn't notify anyone. The embed and card are the real ones.
        content: 'Preview of the join-welcome card. The real one also pings the member with:\n'
          + `> ${payload.content.replace(`<@${user.id}>`, `@${user.username}`)}`,
        embeds: payload.embeds,
        files: payload.files,
      });
    } catch (error) {
      logError('welcome_test failed:', error);
      await interaction.editReply({ content: 'Failed to render the welcome card. Check the logs.' });
    }
  }
}

export default WelcomeTest;
