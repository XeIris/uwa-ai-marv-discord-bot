import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { logError } from '../utils/log';
import {
  AI_TOOL_ALL,
  AI_TOOL_INFO,
  AI_TOOL_KEYS,
  isAiToolKey,
  type AiToolKey,
} from '../utils/aiTools';

const OPTION_ENABLE = 'enable';
const OPTION_DISABLE = 'disable';
const OPTION_VIEW = 'view';

/**
 * Per-user switches for Marv's optional tools — see utils/aiTools.ts for what
 * each one does and why they all default to ON.
 *
 * The setting is per user and global across servers, so it's ephemeral: nobody
 * else needs to see you turning music generation off.
 */
class AiTools extends Command {
  constructor(client: any) {
    super(client, 'tools', 'Turn Marv\'s optional tools on or off for yourself', [
      {
        name: 'tool',
        description: 'Which tool to change',
        type: 3,
        required: true,
        choices: [
          ...AI_TOOL_KEYS.map((key) => ({ name: AI_TOOL_INFO[key].label, value: key })),
          { name: 'All tools', value: AI_TOOL_ALL },
        ],
      },
      {
        name: 'option',
        description: 'Turn it on, turn it off, or just see what it does',
        type: 3,
        required: true,
        choices: [
          { name: 'Enable', value: OPTION_ENABLE },
          { name: 'Disable', value: OPTION_DISABLE },
          { name: 'View (no change)', value: OPTION_VIEW },
        ],
      },
    ], {
      isSubcommandOf: 'ai',
      ephemeral: true,
    });
  }

  /** One "• **Label** — on/off" line per tool. */
  private static formatState(state: Record<AiToolKey, boolean>): string {
    return AI_TOOL_KEYS
      .map((key) => `${state[key] ? '🟢' : '⚪'} **${AI_TOOL_INFO[key].label}** — ${state[key] ? 'on' : 'off'}`)
      .join('\n');
  }

  async run(interaction: any): Promise<void> {
    const userId = interaction.user.id;
    const tool = interaction.options.getString('tool');
    const option = interaction.options.getString('option');

    // Discord enforces the choice lists, but the values still reach SQL, so
    // they're re-checked here rather than trusted.
    const isAll = tool === AI_TOOL_ALL;
    if (!isAll && !isAiToolKey(tool)) {
      await interaction.editReply({ content: 'That is not a tool I know about.' });
      return;
    }
    if (![OPTION_ENABLE, OPTION_DISABLE, OPTION_VIEW].includes(option)) {
      await interaction.editReply({ content: 'That is not a valid option.' });
      return;
    }

    try {
      if (option === OPTION_VIEW) {
        const state = await this.client.db.aiTools.resolve(userId);
        const embed = new EmbedBuilder().setColor('#5865F2');

        if (isAll) {
          embed
            .setTitle('Your AI tools')
            .setDescription(AiTools.formatState(state))
            .setFooter({ text: 'Every tool is on unless you turn it off. Club info is always available.' });
        } else {
          const key = tool as AiToolKey;
          embed
            .setTitle(`${AI_TOOL_INFO[key].label} — ${state[key] ? 'on' : 'off'}`)
            .setDescription(AI_TOOL_INFO[key].description);
        }

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const enable = option === OPTION_ENABLE;

      if (isAll) {
        await this.client.db.aiTools.setAll(userId, enable);
        const state = await this.client.db.aiTools.resolve(userId);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(enable ? '#57F287' : '#99AAB5')
              .setTitle(enable ? 'All tools enabled' : 'All tools disabled')
              .setDescription(AiTools.formatState(state)),
          ],
        });
        return;
      }

      const key = tool as AiToolKey;
      const stored = await this.client.db.aiTools.set(userId, key, enable);
      if (!stored) {
        await interaction.editReply({ content: 'Failed to save that setting. Please try again.' });
        return;
      }

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(enable ? '#57F287' : '#99AAB5')
            .setTitle(`${AI_TOOL_INFO[key].label} ${enable ? 'enabled' : 'disabled'}`)
            .setDescription(AI_TOOL_INFO[key].description)
            .setFooter({ text: 'Applies to you in every server, from your next message.' }),
        ],
      });
    } catch (err) {
      logError('AiTools error:', err);
      await interaction.editReply({ content: 'Failed to change your tool settings. Please try again.' });
    }
  }
}

export default AiTools;
