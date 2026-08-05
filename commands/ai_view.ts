import * as Discord from 'discord.js';
import { Command } from './classes/Command';
import { logError } from '../utils/log';
import { getPersonaInvokeLabel, getPersonaModelName } from '../utils/ai';

const SESSIONS_PER_PAGE = 10;
const PAGINATION_TIMEOUT_MS = 60000;
const MAX_SEARCH_CHARS = 100;

class AiView extends Command {
  constructor(client: any) {
    super(client, 'view', 'View all your AI chat sessions', [
      {
        name: 'search',
        description: 'Filter sessions by title, AI name/trigger, or model (e.g. "mimo", "deepseek")',
        type: 3,
        required: false,
      },
    ], {
      isSubcommandOf: 'ai',
      blame: 'xei',
    });
  }

  // eslint-disable-next-line class-methods-use-this
  buildEmbed(sessions: any[], page: number, maxPage: number, search: string): Discord.EmbedBuilder {
    const start = page * SESSIONS_PER_PAGE;
    const rows = sessions.slice(start, start + SESSIONS_PER_PAGE).map((s: any) => {
      const status = s.active === 1 ? '🟢 Active' : '⚫ Inactive';
      const messageCount = Number.isFinite(Number(s.messageCount)) ? Number(s.messageCount) : 0;
      const messageLabel = messageCount === 1 ? 'message' : 'messages';
      const date = new Date(s.createdAt).toLocaleDateString('en-GB', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
      const ai = getPersonaInvokeLabel(s.personaName);
      return `**[${s.sessionId}]** ${s.title || s.personaName} · ${status} · ${messageCount} ${messageLabel} · Created ${date} · ${ai}`;
    });

    const filterNote = search ? ` · Filter: "${search}"` : '';
    return new Discord.EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🤖 Your AI Chat Sessions')
      .setDescription(rows.join('\n'))
      .setFooter({
        text: `Page ${page + 1}/${maxPage + 1} · ${sessions.length} session${sessions.length === 1 ? '' : 's'}${filterNote}`
          + ' · Use /ai chatnew, /ai chatswitch, /ai chatdelete, or /ai retitle.',
      });
  }

  // eslint-disable-next-line class-methods-use-this
  buildButtons(page: number, maxPage: number, disableAll = false): Discord.ActionRowBuilder<Discord.ButtonBuilder> {
    return new Discord.ActionRowBuilder<Discord.ButtonBuilder>()
      .addComponents(
        new Discord.ButtonBuilder()
          .setCustomId('prev_page')
          .setLabel('⬅️ Back')
          .setStyle(Discord.ButtonStyle.Primary)
          .setDisabled(disableAll || page === 0),
        new Discord.ButtonBuilder()
          .setCustomId('next_page')
          .setLabel('Next ➡️')
          .setStyle(Discord.ButtonStyle.Primary)
          .setDisabled(disableAll || page === maxPage),
      );
  }

  async run(interaction: any): Promise<void> {
    const userId = interaction.user.id;
    const search = String(interaction.options.getString('search') || '')
      .trim().toLowerCase().slice(0, MAX_SEARCH_CHARS);

    try {
      // Only Discord-source sessions — web-created (source='web') chats from
      // the /games/ai-slop UI deliberately live in their own world and would
      // be confusing to surface here (they share no memory with the bot).
      const allSessions = await this.client.db.aiChat.getUserDiscordSessions(userId);

      // Search matches the session title, persona name, invoke trigger
      // (e.g. "DS"), configured model id (e.g. "deepseek/deepseek-v4-flash-0731"),
      // or the numeric session id.
      const sessions = search
        ? allSessions.filter((s: any) => [
          s.title || '',
          s.personaName || '',
          getPersonaInvokeLabel(s.personaName),
          getPersonaModelName(s.personaName),
          String(s.sessionId),
        ].join(' ').toLowerCase().includes(search))
        : allSessions;

      if (sessions.length === 0) {
        const description = allSessions.length === 0
          ? "You don't have any sessions yet. Mention an AI (e.g. `@grok`) to start one!"
          : `No sessions match \`${search}\`. Try a persona name (e.g. "mimo"), a model (e.g. "deepseek"), or part of a title.`;
        await interaction.editReply({
          embeds: [
            new Discord.EmbedBuilder()
              .setColor('#5865F2')
              .setTitle('🤖 Your AI Chat Sessions')
              .setDescription(description),
          ],
        });
        return;
      }

      let currentPage = 0;
      const maxPage = Math.ceil(sessions.length / SESSIONS_PER_PAGE) - 1;

      // Single page — no buttons, no collector.
      if (maxPage === 0) {
        await interaction.editReply({ embeds: [this.buildEmbed(sessions, 0, 0, search)] });
        return;
      }

      const message = await interaction.editReply({
        embeds: [this.buildEmbed(sessions, currentPage, maxPage, search)],
        components: [this.buildButtons(currentPage, maxPage)],
      });

      const collector = message.createMessageComponentCollector({
        time: PAGINATION_TIMEOUT_MS,
        filter: (i: any) => i.user.id === userId,
      });

      collector.on('collect', async (i: any) => {
        if (i.customId === 'prev_page' && currentPage > 0) {
          currentPage -= 1;
        } else if (i.customId === 'next_page' && currentPage < maxPage) {
          currentPage += 1;
        }
        await i.update({
          embeds: [this.buildEmbed(sessions, currentPage, maxPage, search)],
          components: [this.buildButtons(currentPage, maxPage)],
        });
      });

      collector.on('end', async () => {
        await message.edit({
          components: [this.buildButtons(currentPage, maxPage, true)],
        }).catch(() => { /* message may have been deleted */ });
      });
    } catch (err) {
      logError('AiView error:', err);
      await interaction.editReply({ content: 'Failed to retrieve your sessions. Please try again.' });
    }
  }
}

export default AiView;
